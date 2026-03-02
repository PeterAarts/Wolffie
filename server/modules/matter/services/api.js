// modules/matter/services/api.js
import { Environment } from "@matter/main";
import { ManualPairingCodeCodec } from "@matter/main/types";
import { GeneralCommissioning } from "@matter/main/clusters";
import {
  ElectricalPowerMeasurementCluster,
  ElectricalEnergyMeasurementCluster,
} from "@matter/main/clusters";
import "@matter/nodejs"; // Side-effect import for Node.js platform support

// CommissioningController has not yet migrated to @matter/main — still lives here
import { CommissioningController } from "@project-chip/matter.js";

class MatterAPI {
  constructor() {
    this.controller = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    try {
      const environment = Environment.default;

      this.controller = new CommissioningController({
        environment: {
          environment,
          id: "wolffie-matter-controller",
        },
        adminFabricLabel: "Wolffie Hub", // Required since matter.js v0.12
        autoConnect: false,              // Connect to nodes on demand, not on startup
      });

      await this.controller.start();
      this.initialized = true;
      console.log('     - Matter Controller initialized \x1b[32m✓\x1b[37m');
    } catch (error) {
      console.error('\x1b[91m   • Failed to initialize Matter API:', error, '\x1b[37m');
      throw error;
    }
  }

  /**
   * Decode a QR code string (MT:...) into passcode + long discriminator.
   */
  _decodeQrCode(qrCode) {
    const BASE38_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ -.';

    function base38Decode(str) {
      let value = BigInt(0);
      for (let i = str.length - 1; i >= 0; i--) {
        const idx = BASE38_CHARS.indexOf(str[i]);
        if (idx < 0) throw new Error(`Invalid Base38 character: '${str[i]}'`);
        value = value * BigInt(38) + BigInt(idx);
      }
      return value;
    }

    function bits(value, offset, length) {
      const mask = (BigInt(1) << BigInt(length)) - BigInt(1);
      return Number((value >> BigInt(offset)) & mask);
    }

    const raw = qrCode.startsWith('MT:') ? qrCode.slice(3) : qrCode;
    const decoded = base38Decode(raw);

    return {
      vendorId:      bits(decoded, 3, 16),
      productId:     bits(decoded, 19, 16),
      customFlow:    bits(decoded, 35, 2),
      discovery:     bits(decoded, 37, 8),
      discriminator: bits(decoded, 45, 12), // long discriminator (12-bit)
      passcode:      bits(decoded, 57, 27),
    };
  }

  /**
   * Commission a new device.
   *
   * Accepts either:
   *   - A manual pairing code  (11-digit string, e.g. "13898722385")
   *   - A QR code string       (e.g. "MT:AJRA21RJ01N81K1HT00")
   *
   * Pass ipAddress when the device is on a different subnet (bypasses mDNS).
   * Port defaults to 5540 (standard Matter port).
   */
  async commissionDevice(pairingCode, ipAddress = null, port = 5540) {
    if (!this.initialized) await this.initialize();
    try {
      let passcode, shortDiscriminator, longDiscriminator;

      // A QR payload contains letters; a manual code is digits (+ dashes) only.
      const isQrCode = /[A-Z]/i.test(pairingCode.replace(/^MT:/i, ''));

      if (isQrCode) {
        // QR code path — normalize to include MT: prefix, then Base38-decode
        const normalized = pairingCode.toUpperCase().startsWith('MT:')
          ? pairingCode.toUpperCase()
          : `MT:${pairingCode.toUpperCase()}`;
        const qr = this._decodeQrCode(normalized);
        passcode          = qr.passcode;
        longDiscriminator = qr.discriminator;
        console.log(`     - Matter: QR decoded → longDiscriminator=${longDiscriminator}, passcode=${passcode}`);
      } else {
        // Manual pairing code path — digits only, has 4-bit short discriminator
        const cleanCode    = pairingCode.toString().replace(/-/g, '');
        const decoded      = ManualPairingCodeCodec.decode(cleanCode);
        passcode           = decoded.passcode;
        shortDiscriminator = decoded.shortDiscriminator;
        console.log(`     - Matter: Manual code decoded → shortDiscriminator=${shortDiscriminator}, passcode=${passcode}`);
      }

      // Build discovery options.
      // If an IP is provided the device is cross-subnet — bypass mDNS and connect directly.
      let discovery;
      if (ipAddress) {
        console.log(`     - Matter: Using direct IP commissioning → ${ipAddress}:${port}`);
        discovery = {
          knownAddress: { type: "udp", ip: ipAddress, port },
          identifierData: longDiscriminator !== undefined
            ? { longDiscriminator }
            : { shortDiscriminator },
        };
      } else {
        // SwitchBot and some other devices generate a NEW discriminator each pairing session.
        // The QR code passcode is still valid, but the discriminator changes.
        // So we do a short mDNS scan first to find whatever is currently advertising
        // as commissionable, and use its live discriminator instead.
        console.log('     - Matter: Scanning mDNS to find live discriminator...');
        const found = await this._findCommissionableDevice();
        if (found) {
          console.log(`     - Matter: Found live device → discriminator=${found.discriminator} ip=${found.ip}`);
          discovery = {
            knownAddress: { type: "udp", ip: found.ip, port: found.port },
            identifierData: { longDiscriminator: found.discriminator },
          };
        } else {
          // Fallback: use discriminator from QR/manual code
          console.log('     - Matter: No live device found via mDNS, using decoded discriminator');
          discovery = {
            identifierData: longDiscriminator !== undefined
              ? { longDiscriminator }
              : { shortDiscriminator },
          };
        }
      }

      const options = {
        commissioning: {
          regulatoryLocation: GeneralCommissioning.RegulatoryLocationType.IndoorOutdoor,
          regulatoryCountryCode: "XX",
        },
        discovery,
        passcode,
      };

      const nodeId = await this.controller.commissionNode(options);
      console.log(`     - Matter: Commissioned node ${nodeId} \x1b[32m✓\x1b[37m`);
      return nodeId;
    } catch (error) {
      console.error(`   • Matter API - Commissioning failed:`, error.message, '\x1b[37m');
      throw new Error(`Commissioning failed: ${error.message}`);
    }
  }

  /**
   * Scans mDNS briefly to find a device currently in commissioning/pairing mode.
   * Returns the live discriminator and IP so we can commission regardless of
   * what discriminator is encoded in the QR/manual code.
   */
  async _findCommissionableDevice(timeoutMs = 5000) {
    try {
      const discovered = await Promise.race([
        this.controller.discoverCommissionableDevices({}),
        new Promise(resolve => setTimeout(() => resolve([]), timeoutMs)),
      ]);

      if (!discovered || discovered.length === 0) return null;

      // Pick the first commissionable device found
      const device = discovered[0];
      const addr = device.addresses?.find(a => a.ip && !a.ip.startsWith('fe80')); // prefer IPv4

      if (!addr) return null;

      return {
        discriminator: device.discriminator,
        ip: addr.ip,
        port: addr.port || 5540,
      };
    } catch {
      return null;
    }
  }

  /**
   * Reads live power and energy data from a commissioned Matter node.
   */
  async getDeviceAttributes(nodeId) {
    try {
      const node = await this.controller.connectNode(nodeId);

      if (!node) {
        throw new Error(`Node ${nodeId} not found. Check if it is paired.`);
      }

      const powerClient = node.getClusterClient(ElectricalPowerMeasurementCluster);
      const powerAttrs  = await powerClient.readAllAttributes();

      const energyClient = node.getClusterClient(ElectricalEnergyMeasurementCluster);
      const energyAttrs  = await energyClient.readAllAttributes();

      return {
        activePower:      powerAttrs.activePower || 0,
        voltage:          powerAttrs.rmsVoltage  || 0,
        current:          powerAttrs.rmsCurrent  || 0,
        cumulativeEnergy: energyAttrs.cumulativeEnergyImported?.energy || 0,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Retrieves basic metadata about a commissioned node.
   */
  async getNodeInfo(nodeId) {
    const nodes = this.controller.getCommissionedNodesDetails();
    const node  = nodes.find(n => n.nodeId.toString() === nodeId.toString());
    return {
      productName: node?.advertisedName || "Matter Device",
      deviceType:  "socket",
      vendor:      "Unknown",
    };
  }

  /**
   * Scans for uncommissioned devices via mDNS (same subnet only).
   */
  async discoverUncommissionedDevices() {
    if (!this.initialized) await this.initialize();
    console.log('   • Matter: Scanning for uncommissioned devices via mDNS...');

    const discovered = await this.controller.discoverCommissionableDevices({});

    return discovered.map(device => ({
      ip_address:        device.addresses?.[0]?.ip,
      device_identifier: device.deviceIdentifier,
      discriminator:     device.discriminator,
      vendor_id:         device.vendorId,
      product_id:        device.productId,
      product_name:      `Matter Device (${device.productId})`,
    }));
  }

  /**
   * Removes a node from the Matter fabric.
   */
  async unpairNode(nodeId) {
    if (this.controller) {
      await this.controller.removeNode(nodeId);
    }
  }

  /**
   * Graceful shutdown — called when WattsOn server stops.
   */
  async stop() {
    if (this.controller) {
      await this.controller.stop();
      this.initialized = false;
    }
  }
}

export default new MatterAPI();