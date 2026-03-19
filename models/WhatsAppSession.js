/**
 * WhatsApp Session and Message Log models using Supabase.
 * Provides persistence across service restarts.
 */

import crypto from 'crypto';
import { supabase } from '../supabase.js';

// ─── WhatsApp Session Model ─────────────────────────────────────────────────
export const WhatsAppSession = {
    /** Find session by filter */
    findOne: async (filter) => {
        try {
            const sessionId = filter?.sessionId || 'default';
            const { data, error } = await supabase
                .from('whatsapp_sessions')
                .select('*')
                .eq('session_id', sessionId)
                .single();

            if (error) {
                if (error.code === 'PGRST205') {
                    console.log('WhatsApp sessions table not found, using in-memory fallback');
                    return null; // Table doesn't exist yet
                }
                console.error('Error fetching WhatsApp session:', error);
                return null;
            }

            return data;
        } catch (err) {
            console.error('Error in WhatsAppSession.findOne:', err);
            return null;
        }
    },

    /** Find and update session with upsert */
    findOneAndUpdate: async (filter, update, options = {}) => {
        try {
            const sessionId = filter?.sessionId || 'default';
            const updateData = {
                ...update,
                updated_at: new Date().toISOString()
            };

            const { data, error } = await supabase
                .from('whatsapp_sessions')
                .upsert({
                    session_id: sessionId,
                    ...updateData
                }, {
                    onConflict: 'session_id',
                    returning: 'representation'
                })
                .select()
                .single();

            if (error) {
                if (error.code === 'PGRST205') {
                    console.log('WhatsApp sessions table not found, using in-memory fallback');
                    return null; // Table doesn't exist yet
                }
                console.error('Error upserting WhatsApp session:', error);
                return null;
            }

            return data;
        } catch (err) {
            console.error('Error in WhatsAppSession.findOneAndUpdate:', err);
            return null;
        }
    },
};

// ─── Message Log Model ──────────────────────────────────────────────────────
export const MessageLog = {
    /** Create a new message log entry */
    create: async (data) => {
        try {
            const logData = {
                id: data._id || crypto.randomUUID(),
                to: data.to,
                type: data.type || 'text',
                content: data.content,
                status: data.status || 'queued',
                error: data.error || null,
                sent_at: data.sentAt ? new Date(data.sentAt).toISOString() : null,
                created_at: new Date().toISOString()
            };

            const { data: result, error } = await supabase
                .from('whatsapp_messages')
                .insert(logData)
                .select()
                .single();

            if (error) {
                console.error('Error creating message log:', error);
                return null;
            }

            return result;
        } catch (err) {
            console.error('Error in MessageLog.create:', err);
            return null;
        }
    },

    /** Find by ID and update */
    findByIdAndUpdate: async (id, update) => {
        try {
            const updateData = {
                ...update,
                updated_at: new Date().toISOString()
            };

            const { data, error } = await supabase
                .from('whatsapp_messages')
                .update(updateData)
                .eq('id', id)
                .select()
                .single();

            if (error) {
                console.error('Error updating message log:', error);
                return null;
            }

            return data;
        } catch (err) {
            console.error('Error in MessageLog.findByIdAndUpdate:', err);
            return null;
        }
    },

    /** Count documents with optional filter */
    countDocuments: async (filter = {}) => {
        try {
            let query = supabase.from('whatsapp_messages').select('*', { count: 'exact', head: true });

            if (filter.status) {
                query = query.eq('status', filter.status);
            }
            if (filter.to) {
                query = query.ilike('to', `%${filter.to}%`);
            }

            const { count, error } = await query;

            if (error) {
                console.error('Error counting messages:', error);
                return 0;
            }

            return count || 0;
        } catch (err) {
            console.error('Error in MessageLog.countDocuments:', err);
            return 0;
        }
    },

    /** Find with chainable sort/skip/limit */
    find: (filter = {}) => {
        return {
            sort: (sortOpt) => {
                return {
                    skip: (n) => {
                        return {
                            limit: (l) => this._executeFindQuery(filter, sortOpt, n, l)
                        };
                    },
                    limit: (l) => this._executeFindQuery(filter, sortOpt, 0, l)
                };
            }
        };
    },

    /** Execute the find query */
    _executeFindQuery: async (filter, sortOpt, skip, limit) => {
        try {
            let query = supabase.from('whatsapp_messages').select('*');

            // Apply filters
            if (filter.status) {
                query = query.eq('status', filter.status);
            }
            if (filter.to) {
                query = query.ilike('to', `%${filter.to}%`);
            }

            // Apply sorting
            if (sortOpt?.createdAt === -1) {
                query = query.order('created_at', { ascending: false });
            } else {
                query = query.order('created_at', { ascending: true });
            }

            // Apply pagination
            if (skip > 0) {
                query = query.range(skip, skip + limit - 1);
            } else {
                query = query.limit(limit);
            }

            const { data, error } = await query;

            if (error) {
                console.error('Error finding messages:', error);
                return [];
            }

            return data || [];
        } catch (err) {
            console.error('Error in MessageLog._executeFindQuery:', err);
            return [];
        }
    }
};
