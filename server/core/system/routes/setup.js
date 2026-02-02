// server/core/system/routes/setup.js
import express from 'express';
import systemConfigService from '../services/systemConfigService.js';
import db from '../../database.js';

const router = express.Router();

/**
 * GET /api/setup/status
 * Get setup completion status and selected model
 */
router.get('/status', async (req, res) => {
  try {
    const setupCompleted = await systemConfigService.isSetupCompleted();
    const selectedModel = await systemConfigService.getSelectedModel();
    
    res.json({ 
      success: true,
      setupCompleted: !!setupCompleted, 
      selectedModel 
    });
  } catch (error) {
    console.error('Error getting setup status:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

/**
 * GET /api/setup/models
 * Get available inverter models
 */
router.get('/models', async (req, res) => {
  try {
    const [models] = await db.pool.query(
      'SELECT * FROM inverter_models ORDER BY manufacturer, model_name'
    );
    
    res.json({ 
      success: true,
      models 
    });
  } catch (error) {
    console.error('Error getting models:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

/**
 * POST /api/setup/select-model
 * Select an inverter model
 */
router.post('/select-model', async (req, res) => {
  try {
    const { modelId } = req.body;
    
    if (!modelId) {
      return res.status(400).json({ 
        success: false,
        error: 'Model ID is required' 
      });
    }

    // Verify model exists
    const [models] = await db.pool.query(
      'SELECT id FROM inverter_models WHERE id = ?', 
      [modelId]
    );
    
    if (models.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Model not found' 
      });
    }

    // Set the selected model
    await systemConfigService.setSelectedModel(modelId);
    
    res.json({ 
      success: true, 
      message: 'Model saved successfully' 
    });
  } catch (error) {
    console.error('Error selecting model:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

/**
 * POST /api/setup/complete
 * Mark setup as completed
 */
router.post('/complete', async (req, res) => {
  try {
    await systemConfigService.completeSetup();
    
    res.json({ 
      success: true, 
      message: 'Setup completed successfully' 
    });
  } catch (error) {
    console.error('Error completing setup:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

/**
 * GET /api/setup/step
 * Get current setup step
 */
router.get('/step', async (req, res) => {
  try {
    const currentStep = await systemConfigService.get('setup_step') || 1;
    
    res.json({ 
      success: true,
      currentStep: Number(currentStep)
    });
  } catch (error) {
    console.error('Error getting setup step:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

/**
 * POST /api/setup/step
 * Update current setup step
 */
router.post('/step', async (req, res) => {
  try {
    const { step } = req.body;
    
    if (!step || step < 1 || step > 5) {
      return res.status(400).json({ 
        success: false,
        error: 'Valid step number (1-5) required' 
      });
    }

    await systemConfigService.set('setup_step', step);
    
    res.json({ 
      success: true,
      currentStep: step
    });
  } catch (error) {
    console.error('Error updating setup step:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

export default router;