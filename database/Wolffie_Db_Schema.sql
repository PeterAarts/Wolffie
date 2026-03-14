-- --------------------------------------------------------
-- Host:                         192.168.1.160
-- Server version:               11.6.2-MariaDB - mariadb.org binary distribution
-- Server OS:                    Win64
-- HeidiSQL Version:             12.5.0.6677
-- --------------------------------------------------------

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET NAMES utf8 */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;


-- Dumping database structure for alpha_ess
CREATE DATABASE IF NOT EXISTS `alpha_ess` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci */;
USE `alpha_ess`;

-- Dumping structure for table alpha_ess.auth_audit_log
CREATE TABLE IF NOT EXISTS `auth_audit_log` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `username` varchar(50) DEFAULT NULL,
  `event_type` enum('login','logout','failed_login','token_refresh','password_change','account_locked') NOT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text DEFAULT NULL,
  `success` tinyint(1) DEFAULT 1,
  `error_message` text DEFAULT NULL,
  `timestamp` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_event_type` (`event_type`),
  KEY `idx_timestamp` (`timestamp`),
  CONSTRAINT `auth_audit_log_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=1262 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.collector_runs
CREATE TABLE IF NOT EXISTS `collector_runs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `collector_name` varchar(100) NOT NULL,
  `run_start` timestamp NULL DEFAULT current_timestamp(),
  `run_end` timestamp NULL DEFAULT NULL,
  `status` enum('running','success','failed','partial') DEFAULT 'running',
  `records_collected` int(11) DEFAULT 0,
  `error_message` text DEFAULT NULL,
  `execution_time_ms` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_collector_name` (`collector_name`),
  KEY `idx_run_start` (`run_start`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.collector_settings
CREATE TABLE IF NOT EXISTS `collector_settings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `collector_name` varchar(100) NOT NULL,
  `enabled` tinyint(1) DEFAULT 1,
  `schedule_cron` varchar(100) DEFAULT '0 6 * * *',
  `last_run` timestamp NULL DEFAULT NULL,
  `next_run` timestamp NULL DEFAULT NULL,
  `config` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`config`)),
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `collector_name` (`collector_name`),
  KEY `idx_enabled` (`enabled`),
  KEY `idx_next_run` (`next_run`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.day_ahead_prices
CREATE TABLE IF NOT EXISTS `day_ahead_prices` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `datetime` datetime NOT NULL,
  `price_eur_per_mwh` decimal(10,4) NOT NULL,
  `price_eur_per_kwh` decimal(10,6) NOT NULL,
  `country_code` varchar(2) DEFAULT 'NL',
  `bidding_zone` varchar(10) DEFAULT 'NL',
  `data_source` varchar(50) DEFAULT 'entsoe',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_datetime_zone` (`datetime`,`bidding_zone`),
  KEY `idx_datetime` (`datetime`),
  KEY `idx_country` (`country_code`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=142945 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.device_daily_usage
CREATE TABLE IF NOT EXISTS `device_daily_usage` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `device_id` varchar(100) NOT NULL,
  `date` date NOT NULL,
  `usage_kwh` decimal(10,3) NOT NULL DEFAULT 0.000,
  `last_update` date DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_device_day` (`device_id`,`date`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=22958 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.device_measurements
CREATE TABLE IF NOT EXISTS `device_measurements` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `timestamp` timestamp(3) NOT NULL,
  `device_id` varchar(100) NOT NULL,
  `device_type` varchar(50) NOT NULL,
  `device_name` varchar(100) DEFAULT NULL,
  `source` varchar(50) NOT NULL,
  `power` decimal(10,3) DEFAULT 0.000,
  `voltage` decimal(10,3) DEFAULT 0.000,
  `current` decimal(10,3) DEFAULT 0.000,
  `energy_today` decimal(10,3) DEFAULT 0.000,
  `energy_total` decimal(12,3) DEFAULT 0.000,
  `extra_metrics` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`extra_metrics`)),
  PRIMARY KEY (`id`),
  KEY `idx_device_timestamp` (`device_id`,`timestamp`),
  KEY `idx_timestamp` (`timestamp`),
  KEY `idx_source` (`source`)
) ENGINE=InnoDB AUTO_INCREMENT=1232391 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.device_settings
CREATE TABLE IF NOT EXISTS `device_settings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT 'User-friendly name (e.g., "Main Meter", "Solar Meter")',
  `ip_address` varchar(45) NOT NULL COMMENT 'IP address of P1 meter device',
  `port` int(11) DEFAULT 80 COMMENT 'HTTP port (default 80)',
  `product_type` varchar(20) DEFAULT 'HWE-P1' COMMENT 'Device type: HWE-P1, HWE-SKT, HWE-WTR, etc.',
  `module` varchar(30) DEFAULT NULL COMMENT 'ex HomeWizard',
  `product_name` varchar(100) DEFAULT NULL COMMENT 'Device product name from API (e.g., "Energy Socket")',
  `serial` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT 'Device serial/MAC address for unique identification',
  `enabled` tinyint(1) DEFAULT 1 COMMENT 'Whether this meter is active',
  `poll_interval` int(11) DEFAULT 10 COMMENT 'Polling interval in seconds',
  `switch_lock` tinyint(1) DEFAULT 0,
  `power_on` tinyint(1) DEFAULT 1,
  `brightness` int(4) DEFAULT 150,
  `priority` int(11) DEFAULT 3 COMMENT 'Data source priority (1=highest, lower=fallback)',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_ip_port` (`ip_address`,`port`),
  UNIQUE KEY `idx_serial` (`serial`),
  KEY `idx_enabled` (`enabled`),
  KEY `idx_priority` (`priority`),
  KEY `idx_product_type` (`product_type`)
) ENGINE=InnoDB AUTO_INCREMENT=38 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Device P1 meter configurations';

-- Data exporting was unselected.

-- Dumping structure for view alpha_ess.electricity_price_summary
-- Creating temporary table to overcome VIEW dependency errors
CREATE TABLE `electricity_price_summary` (
	`date` DATE NULL,
	`min_price` DECIMAL(10,6) NULL,
	`max_price` DECIMAL(10,6) NULL,
	`avg_price` DECIMAL(14,10) NULL,
	`hours_available` BIGINT(21) NOT NULL,
	`bidding_zone` VARCHAR(10) NULL COLLATE 'utf8mb4_unicode_ci',
	`country_code` VARCHAR(2) NULL COLLATE 'utf8mb4_unicode_ci'
) ENGINE=MyISAM;

-- Dumping structure for table alpha_ess.electricity_tariffs
CREATE TABLE IF NOT EXISTS `electricity_tariffs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL,
  `import_rate` decimal(8,4) DEFAULT NULL COMMENT 'Import rate (€/kWh)',
  `export_rate` decimal(8,4) DEFAULT NULL COMMENT 'Export rate (€/kWh)',
  `days_of_week` set('mon','tue','wed','thu','fri','sat','sun') DEFAULT NULL COMMENT 'Applicable days',
  `active` tinyint(1) DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `idx_active` (`active`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Electricity pricing tariffs';

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.energy_daily
CREATE TABLE IF NOT EXISTS `energy_daily` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `date` date NOT NULL,
  `pv_generation_kwh` decimal(8,2) DEFAULT NULL COMMENT 'Total PV generation',
  `grid_import_kwh` decimal(8,2) DEFAULT NULL COMMENT 'Total grid import',
  `grid_export_kwh` decimal(8,2) DEFAULT NULL COMMENT 'Total grid export',
  `battery_charge_kwh` decimal(8,2) DEFAULT NULL COMMENT 'Total battery charging',
  `battery_discharge_kwh` decimal(8,2) DEFAULT NULL COMMENT 'Total battery discharging',
  `load_consumption_kwh` decimal(8,2) DEFAULT NULL COMMENT 'Total consumption',
  `self_consumption_rate` decimal(5,2) DEFAULT NULL COMMENT '% of PV used directly (not exported)',
  `self_sufficiency_rate` decimal(5,2) DEFAULT NULL COMMENT '% of load met by PV+battery',
  `battery_soc_min` tinyint(4) DEFAULT NULL,
  `battery_soc_max` tinyint(4) DEFAULT NULL,
  `battery_soc_avg` decimal(5,2) DEFAULT NULL,
  `battery_cycles` decimal(5,2) DEFAULT NULL COMMENT 'Estimated charge cycles',
  `pv_peak_power` int(11) DEFAULT NULL COMMENT 'Peak PV power (W)',
  `pv_hours` decimal(4,1) DEFAULT NULL COMMENT 'Equivalent full sun hours',
  `cost_grid_import` decimal(8,2) DEFAULT NULL COMMENT 'Cost of imported electricity',
  `revenue_grid_export` decimal(8,2) DEFAULT NULL COMMENT 'Revenue from exported electricity',
  `savings` decimal(8,2) DEFAULT NULL COMMENT 'Total savings',
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_date` (`date`),
  KEY `idx_date_range` (`date`)
) ENGINE=InnoDB AUTO_INCREMENT=41 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Daily summaries';

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.energy_hours
CREATE TABLE IF NOT EXISTS `energy_hours` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `timestamp` datetime NOT NULL COMMENT 'Start of hour',
  `battery_soc_avg` decimal(5,2) DEFAULT NULL,
  `battery_power_avg` int(11) DEFAULT NULL,
  `grid_power_avg` int(11) DEFAULT NULL,
  `pv_power_avg` int(11) DEFAULT NULL,
  `load_power_avg` int(11) DEFAULT NULL,
  `pv_energy_wh` int(11) DEFAULT NULL COMMENT 'PV generation this hour',
  `grid_import_wh` int(11) DEFAULT NULL COMMENT 'Energy imported from grid',
  `grid_export_wh` int(11) DEFAULT NULL COMMENT 'Energy exported to grid',
  `battery_charge_wh` int(11) DEFAULT NULL COMMENT 'Energy charged to battery',
  `battery_discharge_wh` int(11) DEFAULT NULL COMMENT 'Energy discharged from battery',
  `load_consumption_wh` int(11) DEFAULT NULL COMMENT 'Total consumption',
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_timestamp` (`timestamp`)
) ENGINE=InnoDB AUTO_INCREMENT=49757 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Per-hour aggregates';

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.energy_minutes
CREATE TABLE IF NOT EXISTS `energy_minutes` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `timestamp` datetime NOT NULL COMMENT 'Start of minute',
  `battery_soc_avg` decimal(5,2) DEFAULT NULL,
  `battery_power_avg` int(11) DEFAULT NULL,
  `battery_charge_wh` decimal(10,2) DEFAULT 0.00,
  `battery_discharge_wh` decimal(10,2) DEFAULT 0.00,
  `battery_temperature_avg` decimal(4,1) DEFAULT NULL,
  `grid_power_avg` int(11) DEFAULT NULL,
  `pv_power_avg` int(11) DEFAULT NULL,
  `pv_energy_wh` decimal(10,2) DEFAULT 0.00,
  `load_power_avg` int(11) DEFAULT NULL,
  `load_energy_wh` decimal(10,2) DEFAULT 0.00,
  `battery_soc_min` tinyint(4) DEFAULT NULL,
  `battery_soc_max` tinyint(4) DEFAULT NULL,
  `pv_power_max` int(11) DEFAULT NULL,
  `grid_power_min` int(11) DEFAULT NULL,
  `grid_power_max` int(11) DEFAULT NULL,
  `grid_import_wh` decimal(10,2) DEFAULT 0.00,
  `grid_export_wh` decimal(10,2) DEFAULT 0.00,
  `sample_count` int(11) DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_timestamp` (`timestamp`)
) ENGINE=InnoDB AUTO_INCREMENT=57186 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Per-minute aggregates';

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.energy_monthly
CREATE TABLE IF NOT EXISTS `energy_monthly` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `year` int(11) NOT NULL,
  `month` tinyint(4) NOT NULL,
  `pv_generation_kwh` decimal(10,2) DEFAULT NULL,
  `grid_import_kwh` decimal(10,2) DEFAULT NULL,
  `grid_export_kwh` decimal(10,2) DEFAULT NULL,
  `battery_charge_kwh` decimal(10,2) DEFAULT NULL,
  `battery_discharge_kwh` decimal(10,2) DEFAULT NULL,
  `load_consumption_kwh` decimal(10,2) DEFAULT NULL,
  `self_consumption_rate` decimal(5,2) DEFAULT NULL,
  `self_sufficiency_rate` decimal(5,2) DEFAULT NULL,
  `cost_grid_import` decimal(10,2) DEFAULT NULL,
  `revenue_grid_export` decimal(10,2) DEFAULT NULL,
  `savings` decimal(10,2) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_year_month` (`year`,`month`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Monthly summaries';

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.energy_snapshots
CREATE TABLE IF NOT EXISTS `energy_snapshots` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `timestamp` timestamp(3) NOT NULL,
  `source` varchar(50) NOT NULL,
  `device_id` varchar(100) DEFAULT NULL,
  `solar_power` int(11) DEFAULT 0,
  `solar_energy_today` decimal(10,2) DEFAULT 0.00,
  `battery_power` int(11) DEFAULT 0,
  `battery_soc` tinyint(4) DEFAULT 0,
  `battery_voltage` decimal(6,2) DEFAULT 0.00,
  `battery_current` decimal(8,2) DEFAULT 0.00,
  `battery_temp` decimal(4,1) DEFAULT 0.0,
  `grid_power` int(11) DEFAULT 0,
  `grid_voltage_l1` decimal(5,1) DEFAULT 0.0,
  `grid_voltage_l2` decimal(5,1) DEFAULT 0.0,
  `grid_voltage_l3` decimal(5,1) DEFAULT 0.0,
  `grid_current_l1` decimal(7,2) DEFAULT 0.00,
  `grid_current_l2` decimal(7,2) DEFAULT 0.00,
  `grid_current_l3` decimal(7,2) DEFAULT 0.00,
  `grid_frequency` decimal(5,2) DEFAULT 50.00,
  `grid_energy_import_today` decimal(10,2) DEFAULT 0.00,
  `grid_energy_export_today` decimal(10,2) DEFAULT 0.00,
  `load_power` int(11) DEFAULT 0,
  `load_energy_today` decimal(10,2) DEFAULT 0.00,
  `inverter_temp` decimal(4,1) DEFAULT 0.0,
  `inverter_power` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `battery_charge_today` decimal(10,2) DEFAULT 0.00 COMMENT 'Today battery charge (kWh)',
  `battery_discharge_today` decimal(10,2) DEFAULT 0.00 COMMENT 'Today battery discharge (kWh)',
  `trees_equivalent` decimal(10,4) DEFAULT 0.0000 COMMENT 'Equivalent trees planted',
  `co2_offset_kg` decimal(10,4) DEFAULT 0.0000 COMMENT 'CO2 offset (kg)',
  PRIMARY KEY (`id`),
  KEY `idx_timestamp` (`timestamp`),
  KEY `idx_source` (`source`),
  KEY `idx_device_id` (`device_id`),
  KEY `idx_source_timestamp` (`source`,`timestamp`)
) ENGINE=InnoDB AUTO_INCREMENT=37043 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.energy_usage_profiles
CREATE TABLE IF NOT EXISTS `energy_usage_profiles` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `day_type` enum('WEEKDAY','WEEKEND') NOT NULL,
  `hour` tinyint(4) NOT NULL CHECK (`hour` between 0 and 23),
  `avg_load_kwh` decimal(10,4) DEFAULT 0.0000,
  `avg_solar_kwh` decimal(10,4) DEFAULT 0.0000,
  `sample_count` int(11) DEFAULT 0,
  `standard_deviation` decimal(10,4) DEFAULT 0.0000,
  `last_updated` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_profile_lookup` (`day_type`,`hour`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.events
CREATE TABLE IF NOT EXISTS `events` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `timestamp` timestamp NOT NULL,
  `category` varchar(50) NOT NULL,
  `action` varchar(20) NOT NULL,
  `source` varchar(20) NOT NULL,
  `details` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`details`)),
  `status` varchar(20) NOT NULL DEFAULT '',
  `userId` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_filter_events` (`timestamp`,`action`,`source`,`status`,`userId`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='a table that captures not just what happened, but why it happened (the source).';

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.inverter_models
CREATE TABLE IF NOT EXISTS `inverter_models` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `manufacturer` varchar(50) NOT NULL,
  `model_name` varchar(100) NOT NULL,
  `model_series` varchar(50) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `battery_capacity_kwh` decimal(5,1) DEFAULT NULL,
  `max_pv_input_kw` decimal(5,1) DEFAULT NULL,
  `mppt_inputs` int(11) DEFAULT NULL,
  `grid_type` enum('single_phase','3_phase','hybrid') DEFAULT 'single_phase',
  `communication_protocol` varchar(50) DEFAULT 'ModBus TCP',
  `default_slave_id` int(11) DEFAULT 85,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_model` (`manufacturer`,`model_name`),
  KEY `idx_manufacturer` (`manufacturer`),
  KEY `idx_active` (`is_active`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.modbus_registers
CREATE TABLE IF NOT EXISTS `modbus_registers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `model_id` int(11) NOT NULL,
  `category_id` int(11) NOT NULL,
  `register_key` varchar(100) NOT NULL,
  `register_name` varchar(200) NOT NULL,
  `description` text DEFAULT NULL,
  `address` int(11) NOT NULL,
  `length` int(11) DEFAULT 1,
  `register_type` enum('input','holding','coil','discrete') DEFAULT 'input',
  `data_type` enum('uint16','int16','uint32','int32','uint64','float','string') DEFAULT 'uint16',
  `scale_factor` decimal(10,6) DEFAULT 1.000000,
  `offset_value` decimal(10,2) DEFAULT 0.00,
  `unit` varchar(20) DEFAULT NULL,
  `min_value` decimal(15,3) DEFAULT NULL,
  `max_value` decimal(15,3) DEFAULT NULL,
  `decimal_places` int(11) DEFAULT 1,
  `is_signed` tinyint(1) DEFAULT 0,
  `is_available` tinyint(1) DEFAULT 1,
  `is_writable` tinyint(1) DEFAULT 0,
  `requires_firmware_version` varchar(20) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `last_tested_date` date DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_register` (`model_id`,`register_key`),
  KEY `category_id` (`category_id`),
  KEY `idx_model_category` (`model_id`,`category_id`),
  KEY `idx_address` (`address`),
  KEY `idx_available` (`is_available`),
  CONSTRAINT `modbus_registers_ibfk_1` FOREIGN KEY (`model_id`) REFERENCES `inverter_models` (`id`) ON DELETE CASCADE,
  CONSTRAINT `modbus_registers_ibfk_2` FOREIGN KEY (`category_id`) REFERENCES `register_categories` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=132 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.module_registry
CREATE TABLE IF NOT EXISTS `module_registry` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `module_id` varchar(50) NOT NULL,
  `module_name` varchar(100) NOT NULL,
  `module_version` varchar(20) NOT NULL,
  `module_type` varchar(50) NOT NULL,
  `enabled` tinyint(1) DEFAULT 1,
  `installed` tinyint(1) DEFAULT 0,
  `has_collector` tinyint(1) DEFAULT 0,
  `has_api` tinyint(1) DEFAULT 0,
  `has_ui` tinyint(1) DEFAULT 0,
  `api_prefix` varchar(100) DEFAULT NULL,
  `settings_component` varchar(100) DEFAULT NULL,
  `collector_interval` int(11) DEFAULT 10000,
  `collector_priority` int(11) DEFAULT 5,
  `description` text DEFAULT NULL,
  `author` varchar(100) DEFAULT NULL,
  `documentation_url` varchar(255) DEFAULT NULL,
  `discovered_at` timestamp NULL DEFAULT current_timestamp(),
  `installed_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `last_seen_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `module_id` (`module_id`),
  KEY `idx_module_id` (`module_id`),
  KEY `idx_enabled` (`enabled`),
  KEY `idx_installed` (`installed`),
  KEY `idx_type` (`module_type`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.refresh_tokens
CREATE TABLE IF NOT EXISTS `refresh_tokens` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `token` varchar(255) NOT NULL,
  `expires_at` timestamp NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `revoked` tinyint(1) DEFAULT 0,
  `revoked_at` timestamp NULL DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token` (`token`),
  KEY `idx_token` (`token`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_expires` (`expires_at`),
  CONSTRAINT `refresh_tokens_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=568 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.register_aliases
CREATE TABLE IF NOT EXISTS `register_aliases` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `register_id` int(11) NOT NULL,
  `alias_address` int(11) NOT NULL,
  `alias_length` int(11) DEFAULT 1,
  `firmware_version` varchar(20) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `register_id` (`register_id`),
  KEY `idx_address` (`alias_address`),
  CONSTRAINT `register_aliases_ibfk_1` FOREIGN KEY (`register_id`) REFERENCES `modbus_registers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.register_categories
CREATE TABLE IF NOT EXISTS `register_categories` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `category_key` varchar(50) NOT NULL,
  `category_name` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `display_order` int(11) DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `category_key` (`category_key`),
  KEY `idx_order` (`display_order`)
) ENGINE=InnoDB AUTO_INCREMENT=25 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.scheduled_dispatch
CREATE TABLE IF NOT EXISTS `scheduled_dispatch` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `enabled` tinyint(1) DEFAULT 1,
  `mode` varchar(50) NOT NULL COMMENT 'charge_from_grid, discharge_to_grid',
  `start_time` time NOT NULL,
  `end_time` time DEFAULT NULL,
  `duration` int(11) DEFAULT NULL COMMENT 'Duration in seconds (alternative to end_time)',
  `target_power` int(11) DEFAULT NULL,
  `target_soc` tinyint(4) DEFAULT NULL,
  `days_of_week` set('mon','tue','wed','thu','fri','sat','sun') DEFAULT NULL,
  `conditions` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'Additional conditions (e.g., SOC < 20%)' CHECK (json_valid(`conditions`)),
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_enabled` (`enabled`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Scheduled dispatch configurations';

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.sessions
CREATE TABLE IF NOT EXISTS `sessions` (
  `session_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `expires` int(11) unsigned NOT NULL,
  `data` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  PRIMARY KEY (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.settings_history
CREATE TABLE IF NOT EXISTS `settings_history` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `setting_id` int(11) NOT NULL,
  `category` varchar(50) NOT NULL,
  `setting_key` varchar(100) NOT NULL,
  `old_value` text DEFAULT NULL,
  `new_value` text DEFAULT NULL,
  `changed_by` varchar(100) DEFAULT 'system',
  `change_reason` text DEFAULT NULL,
  `changed_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_setting_id` (`setting_id`),
  KEY `idx_changed_at` (`changed_at`)
) ENGINE=InnoDB AUTO_INCREMENT=325 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.solar_forecasts
CREATE TABLE IF NOT EXISTS `solar_forecasts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `date` date NOT NULL,
  `expected_kwh` decimal(10,2) NOT NULL,
  `actual_kwh` decimal(10,2) DEFAULT NULL,
  `accuracy_percentage` decimal(5,2) DEFAULT NULL,
  `data_source` varchar(50) DEFAULT 'forecast.solar',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `date` (`date`),
  KEY `idx_date` (`date`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=538 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data exporting was unselected.

-- Dumping structure for view alpha_ess.solar_forecast_accuracy
-- Creating temporary table to overcome VIEW dependency errors
CREATE TABLE `solar_forecast_accuracy` (
	`date` DATE NOT NULL,
	`expected_kwh` DECIMAL(10,2) NOT NULL,
	`actual_kwh` DECIMAL(10,2) NULL,
	`accuracy_percentage` DECIMAL(5,2) NULL,
	`calculated_accuracy` DECIMAL(21,6) NULL,
	`data_source` VARCHAR(50) NULL COLLATE 'utf8mb4_unicode_ci',
	`created_at` TIMESTAMP NULL
) ENGINE=MyISAM;

-- Dumping structure for table alpha_ess.solar_forecast_hourly
CREATE TABLE IF NOT EXISTS `solar_forecast_hourly` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `date` date NOT NULL,
  `slot_datetime` datetime NOT NULL,
  `hourly_wh` decimal(10,2) NOT NULL DEFAULT 0.00,
  `cumulative_wh` decimal(10,2) NOT NULL DEFAULT 0.00,
  `data_source` varchar(50) DEFAULT 'forecast.solar',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_slot_datetime` (`slot_datetime`),
  KEY `idx_date` (`date`)
) ENGINE=InnoDB AUTO_INCREMENT=3749 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.strategy_executions
CREATE TABLE IF NOT EXISTS `strategy_executions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `stategy_id` varchar(50) DEFAULT NULL,
  `calculated_at` timestamp NULL DEFAULT NULL,
  `execution_plan` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`execution_plan`)),
  `status` varchar(20) DEFAULT NULL,
  `created` timestamp NULL DEFAULT current_timestamp(),
  `updated` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  CONSTRAINT `valid_plan` CHECK (json_valid(`execution_plan`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.system_components
CREATE TABLE IF NOT EXISTS `system_components` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `component_key` varchar(100) NOT NULL,
  `name` varchar(200) NOT NULL,
  `type` varchar(50) NOT NULL,
  `category` varchar(50) DEFAULT NULL,
  `parent_id` int(11) DEFAULT NULL,
  `display_order` int(11) NOT NULL DEFAULT 0,
  `level_depth` int(11) NOT NULL DEFAULT 1,
  `location_type` varchar(50) DEFAULT NULL,
  `location_label` varchar(200) DEFAULT NULL,
  `icon` varchar(200) DEFAULT NULL,
  `color` varchar(50) DEFAULT NULL,
  `data_source` varchar(200) DEFAULT NULL,
  `specs` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`specs`)),
  `is_optional` tinyint(1) DEFAULT 0,
  `is_visible` tinyint(1) DEFAULT 1,
  `is_active` tinyint(1) DEFAULT 1,
  `description` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `component_key` (`component_key`),
  KEY `idx_component_key` (`component_key`),
  KEY `idx_type` (`type`),
  KEY `idx_category` (`category`),
  KEY `idx_parent` (`parent_id`),
  KEY `idx_location` (`location_type`),
  KEY `idx_level_depth` (`level_depth`),
  KEY `idx_display_order` (`display_order`),
  CONSTRAINT `system_components_ibfk_1` FOREIGN KEY (`parent_id`) REFERENCES `system_components` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=30 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.system_config
CREATE TABLE IF NOT EXISTS `system_config` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `config_key` varchar(50) NOT NULL,
  `config_value` text DEFAULT NULL,
  `description` text DEFAULT NULL,
  `data_type` enum('string','number','boolean','json') DEFAULT 'string',
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `config_key` (`config_key`)
) ENGINE=InnoDB AUTO_INCREMENT=14 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='System configuration';

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.system_configuration
CREATE TABLE IF NOT EXISTS `system_configuration` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `config_key` varchar(100) NOT NULL,
  `config_value` text DEFAULT NULL,
  `value_type` enum('string','number','boolean','json') DEFAULT 'string',
  `description` text DEFAULT NULL,
  `category` varchar(50) DEFAULT NULL,
  `is_required` tinyint(1) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `config_key` (`config_key`),
  KEY `idx_category` (`category`),
  KEY `idx_key` (`config_key`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.system_events
CREATE TABLE IF NOT EXISTS `system_events` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `timestamp` datetime NOT NULL,
  `event_type` varchar(50) NOT NULL COMMENT 'e.g., dispatch_start, system_error',
  `description` text DEFAULT NULL,
  `severity` enum('info','warning','error','critical') DEFAULT 'info',
  `data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'Additional event data' CHECK (json_valid(`data`)),
  PRIMARY KEY (`id`),
  KEY `idx_timestamp` (`timestamp`),
  KEY `idx_event_type` (`event_type`),
  KEY `idx_severity` (`severity`)
) ENGINE=InnoDB AUTO_INCREMENT=3040 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='System events and errors';

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.system_settings
CREATE TABLE IF NOT EXISTS `system_settings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `category` varchar(50) NOT NULL,
  `setting_key` varchar(100) NOT NULL,
  `setting_value` text DEFAULT NULL,
  `value_type` enum('string','number','boolean','json') DEFAULT 'string',
  `is_module` tinyint(1) DEFAULT 0,
  `module_id` varchar(50) DEFAULT NULL,
  `module_version` varchar(20) DEFAULT NULL,
  `is_encrypted` tinyint(1) DEFAULT 0,
  `editable` tinyint(1) DEFAULT 1,
  `visible` tinyint(1) DEFAULT 1,
  `display_order` int(11) DEFAULT 0,
  `display_name` varchar(100) DEFAULT NULL,
  `required` tinyint(1) DEFAULT 0,
  `validation_rules` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`validation_rules`)),
  `options` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`options`)),
  `enabled` tinyint(1) DEFAULT 1,
  `description` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_setting` (`category`,`setting_key`),
  UNIQUE KEY `unique_category_key` (`category`,`setting_key`),
  KEY `idx_category` (`category`),
  KEY `idx_module` (`is_module`,`module_id`),
  KEY `idx_category_module` (`category`,`module_id`),
  KEY `idx_editable` (`editable`),
  KEY `idx_enabled` (`enabled`)
) ENGINE=InnoDB AUTO_INCREMENT=62349 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data exporting was unselected.

-- Dumping structure for table alpha_ess.users
CREATE TABLE IF NOT EXISTS `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(50) NOT NULL,
  `email` varchar(100) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `full_name` varchar(100) DEFAULT NULL,
  `role` enum('admin','user','viewer') DEFAULT 'user',
  `is_active` tinyint(1) DEFAULT 1,
  `last_password_update` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `last_login_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_username` (`username`),
  KEY `idx_email` (`email`),
  KEY `idx_role` (`role`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data exporting was unselected.

-- Dumping structure for view alpha_ess.v_current_status
-- Creating temporary table to overcome VIEW dependency errors
CREATE TABLE `v_current_status` 
) ENGINE=MyISAM;

-- Dumping structure for view alpha_ess.v_today_summary
-- Creating temporary table to overcome VIEW dependency errors
CREATE TABLE `v_today_summary` (
	`date` DATE NULL,
	`pv_generation_kwh` DECIMAL(36,4) NULL,
	`grid_import_kwh` DECIMAL(36,4) NULL,
	`grid_export_kwh` DECIMAL(36,4) NULL,
	`load_consumption_kwh` DECIMAL(36,4) NULL
) ENGINE=MyISAM;

-- Dumping structure for table alpha_ess._old_component_flows
CREATE TABLE IF NOT EXISTS `_old_component_flows` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `from_component_id` int(11) NOT NULL,
  `to_component_id` int(11) NOT NULL,
  `flow_type` varchar(50) DEFAULT 'primary',
  `flow_direction` varchar(20) DEFAULT 'unidirectional',
  `priority` int(11) DEFAULT 0,
  `conditions` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`conditions`)),
  `arrow_color` varchar(50) DEFAULT NULL,
  `arrow_style` varchar(50) DEFAULT 'solid',
  `is_visible` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_flow` (`from_component_id`,`to_component_id`),
  KEY `idx_from` (`from_component_id`),
  KEY `idx_to` (`to_component_id`),
  KEY `idx_flow_type` (`flow_type`),
  CONSTRAINT `_old_component_flows_ibfk_1` FOREIGN KEY (`from_component_id`) REFERENCES `system_components` (`id`) ON DELETE CASCADE,
  CONSTRAINT `_old_component_flows_ibfk_2` FOREIGN KEY (`to_component_id`) REFERENCES `system_components` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=15 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data exporting was unselected.

-- Dumping structure for view alpha_ess.electricity_price_summary
-- Removing temporary table and create final VIEW structure
DROP TABLE IF EXISTS `electricity_price_summary`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `electricity_price_summary` AS SELECT 
    DATE(datetime) as date,
    MIN(price_eur_per_kwh) as min_price,
    MAX(price_eur_per_kwh) as max_price,
    AVG(price_eur_per_kwh) as avg_price,
    COUNT(*) as hours_available,
    bidding_zone,
    country_code
FROM day_ahead_prices
GROUP BY DATE(datetime), bidding_zone, country_code
ORDER BY date DESC ;

-- Dumping structure for view alpha_ess.solar_forecast_accuracy
-- Removing temporary table and create final VIEW structure
DROP TABLE IF EXISTS `solar_forecast_accuracy`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `solar_forecast_accuracy` AS SELECT 
    sf.date,
    sf.expected_kwh,
    sf.actual_kwh,
    sf.accuracy_percentage,
    CASE 
        WHEN sf.actual_kwh IS NOT NULL THEN 
            (100 - ABS((sf.actual_kwh - sf.expected_kwh) / sf.expected_kwh * 100))
        ELSE NULL
    END AS calculated_accuracy,
    sf.data_source,
    sf.created_at
FROM solar_forecasts sf
ORDER BY sf.date DESC ;

-- Dumping structure for view alpha_ess.v_current_status
-- Removing temporary table and create final VIEW structure
DROP TABLE IF EXISTS `v_current_status`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `v_current_status` AS SELECT 
  timestamp,
  battery_soc,
  battery_power,
  battery_temperature,
  grid_power,
  pv_power,
  load_power
FROM energy_snapshots
ORDER BY timestamp DESC
LIMIT 1 ;

-- Dumping structure for view alpha_ess.v_today_summary
-- Removing temporary table and create final VIEW structure
DROP TABLE IF EXISTS `v_today_summary`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `v_today_summary` AS SELECT 
  DATE(timestamp) as date,
  SUM(CASE WHEN pv_energy_wh > 0 THEN pv_energy_wh ELSE 0 END) / 1000 as pv_generation_kwh,
  SUM(CASE WHEN grid_import_wh > 0 THEN grid_import_wh ELSE 0 END) / 1000 as grid_import_kwh,
  SUM(CASE WHEN grid_export_wh > 0 THEN grid_export_wh ELSE 0 END) / 1000 as grid_export_kwh,
  SUM(CASE WHEN load_consumption_wh > 0 THEN load_consumption_wh ELSE 0 END) / 1000 as load_consumption_kwh
FROM energy_hours
WHERE DATE(timestamp) = CURDATE()
GROUP BY DATE(timestamp) ;

/*!40103 SET TIME_ZONE=IFNULL(@OLD_TIME_ZONE, 'system') */;
/*!40101 SET SQL_MODE=IFNULL(@OLD_SQL_MODE, '') */;
/*!40014 SET FOREIGN_KEY_CHECKS=IFNULL(@OLD_FOREIGN_KEY_CHECKS, 1) */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40111 SET SQL_NOTES=IFNULL(@OLD_SQL_NOTES, 1) */;
