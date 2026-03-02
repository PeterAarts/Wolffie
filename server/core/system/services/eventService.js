// server/core/system/services/eventService.js
import db from '../../database.js';

class EventService {
    async log(data) {
    const { 
        category,  // STRATEGY, MANUAL, SAFETY
        action,    // CHARGE, DISCHARGE, STOP
        source,    // smart_eco, dashboard_ui, price_guard
        userId,    // The ID of the user who performed the action
        details,   // { watts: 3000, reason: 'Manual boost' }
        status = 'SUCCESS' 
    } = data;

    await db.pool.query(
        `INSERT INTO system_events 
        (category, action, source, user_id, details, status) 
        VALUES (?, ?, ?, ?, ?, ?)`,
        [category, action, source, userId || null, JSON.stringify(details), status]
    );
    }
}

export default new EventService();