const express = require('express');
const path = require('path');
const cors = require('cors');

const { config } = require('./config/app-config');
const { createTables } = require('./db');
const { seedData } = require('./seed');

const inventoryRouter = require('./routes/inventory');
const rentalsRouter = require('./routes/rentals');
const usersRouter = require('./routes/users');
const importExportRouter = require('./routes/import-export');
const clientsRouter = require('./routes/clients');
const employeesRouter = require('./routes/employees');
const documentsRouter = require('./routes/documents');
const eventsRouter = require('./routes/events');
const reportsRouter = require('./routes/reports');
const searchRouter = require('./routes/search');

function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname)));

  app.use('/api/inventory', inventoryRouter);
  app.use('/api/rentals', rentalsRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/import-export', importExportRouter);
  app.use('/api/clients', clientsRouter);
  app.use('/api/employees', employeesRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api', reportsRouter);
  app.use('/api/search', searchRouter);

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      environment: config.nodeEnv,
      autoCreateSchema: config.startup.autoCreateSchema,
      autoSeed: config.startup.autoSeed
    });
  });

  return app;
}

async function initializeApp() {
  if (config.startup.autoCreateSchema) {
    await createTables();
  }

  if (config.startup.autoSeed) {
    await seedData({ silent: true });
  }
}

async function startServer() {
  await initializeApp();

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${config.port} is already in use. Stop the previous process or set a different PORT.`);
    } else {
      console.error('Server startup error:', error);
    }
    process.exit(1);
  });

  return { app, server };
}

if (require.main === module) {
  startServer().catch((error) => {
    if (error && error.code === '28P01') {
      console.error('Database authentication failed. Check DATABASE_URL / PostgreSQL password in .env or .env.local.');
      process.exit(1);
    }

    console.error('Error initializing application:', error);
    process.exit(1);
  });
}

module.exports = {
  createApp,
  initializeApp,
  startServer
};
