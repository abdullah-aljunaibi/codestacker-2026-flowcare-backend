import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';

// Route imports
import authRoutes from './routes/auth.js';
import appointmentRoutes from './routes/appointments.js';
import queueRoutes from './routes/queue.js';
import branchRoutes from './routes/branches.js';
import serviceTypeRoutes from './routes/service-types.js';
import slotRoutes from './routes/slots.js';
import staffRoutes from './routes/staff.js';
import customerRoutes from './routes/customers.js';
import auditRoutes from './routes/audit.js';
import uploadRoutes from './routes/uploads.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',');

// Middleware
app.use(cors({
  origin: ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : '*',
  credentials: true,
}));
app.use(express.json());

// Note: Static file serving for /uploads was removed in Phase 5B.
// Files are now served through authenticated routes only (/api/files/*).

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    },
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/queue', queueRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/service-types', serviceTypeRoutes);
app.use('/api/slots', slotRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/files', uploadRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
  });
});

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 FlowCare Backend running on port ${PORT}`);
  console.log(`📍 Health: http://localhost:${PORT}/health`);
  console.log(`📍 API: http://localhost:${PORT}/api`);
});

export default app;
