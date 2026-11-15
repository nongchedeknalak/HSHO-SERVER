'use strict';

require('dotenv').config();
require('module-alias/register');

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const config = require('@config');
const apiRoutes = require('@routes');
const healthRoutes = require('./src/bootstrap/health');

const app = express();

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(healthRoutes);
app.use('/', apiRoutes);

app.get('/', (req, res) => {
  res.status(200).json({
    status: 'OK',
    name: 'HSHO Private Server',
    version: config.server.version,
  });
});

app.use((err, req, res, next) => {
  console.error('Unhandled request error:', err);
  res.status(500).json({ status: 0, data: null, error: 'Internal server error' });
});

async function start() {
  const mongoUri = config.mongo.uri;
  if (!mongoUri) {
    throw new Error('Missing MONGO_URI (or MONGODB_URI) environment variable.');
  }

  try {
    await mongoose.connect(mongoUri, {
      ...(config.mongo.dbName ? { dbName: config.mongo.dbName } : {}),
      serverSelectionTimeoutMS: 15000,
    });
    console.log(`MongoDB connected${mongoose.connection.name ? `: ${mongoose.connection.name}` : ''}`);
  } catch (error) {
    if (error.code === 8000 || /authentication failed|bad auth/i.test(error.message || '')) {
      console.error('MongoDB authentication failed. Check the Atlas Database User username/password and URL-encode special characters in the password.');
      console.error('Also confirm Render Environment has MONGO_URI (or MONGODB_URI) set to the correct connection string.');
    } else {
      console.error('MongoDB connection failed:', error.message);
    }
    throw error;
  }

  const port = Number(config.port) || 3000;
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`HSHO Private Server listening on port ${port}`);
  });

  const shutdown = async (signal) => {
    console.log(`${signal} received; shutting down`);
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((error) => {
  console.error('Startup error:', error.message);
  process.exit(1);
});

module.exports = app;
