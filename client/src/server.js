import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';

const app = express();
const httpServer = createServer(app);

app.use(express.json());

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// --- Hardware Serial Configuration ---
const ARDUINO_PORT = 'COM11'; // <-- CHANGE THIS to your exact Arduino COM port!
const BAUD_RATE = 115200;

let arduinoSerial = null;
let reconnectTimer = null;

// --- List available serial ports ---
app.get('/api/ports', async (req, res) => {
  try {
    const ports = await SerialPort.list();
    res.json(ports);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function connectArduino() {
  try {
    arduinoSerial = new SerialPort({
      path: ARDUINO_PORT,
      baudRate: BAUD_RATE,
      autoOpen: true
    });

    console.log(`📡 Attempting to connect to Arduino on port ${ARDUINO_PORT}...`);

    const parser = arduinoSerial.pipe(new ReadlineParser({ delimiter: '\n' }));

    arduinoSerial.on('open', () => {
      console.log(`✅ Serial Connection Established at ${BAUD_RATE} baud.`);
      io.emit('arduino-status', { connected: true, port: ARDUINO_PORT });
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    });

    arduinoSerial.on('close', () => {
      console.warn('⚠️ Serial port closed. Scheduling reconnect...');
      io.emit('arduino-status', { connected: false });
      scheduleReconnect();
    });

    arduinoSerial.on('error', (err) => {
      console.error(`⚠️ Serial Port Error: ${err.message}`);
      io.emit('hardware-error', `Serial Port Error: ${err.message}`);
      io.emit('arduino-status', { connected: false });
      scheduleReconnect();
    });

    // --- Data Routing ---
    parser.on('data', (dataLine) => {
      const cleanData = dataLine.trim();
      if (!cleanData) return;

      if (cleanData.startsWith('EVENT_DYNAMIC_RUN:')) {
        const timePayload = cleanData.split(':')[1];
        console.log(`⏱️ Dynamic Run! ToF: ${timePayload} ms`);
        io.emit('dynamic-run-captured', parseFloat(timePayload));
      } else if (
        cleanData.includes('Sampling...') ||
        cleanData.includes('>>>') ||
        cleanData.includes('---') ||
        cleanData.includes('Final Mass')
      ) {
        io.emit('system-log', cleanData);
      } else {
        io.emit('telemetry', cleanData);
      }
    });

  } catch (error) {
    console.error(`❌ Critical error initializing serial port: ${error.message}`);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    console.log('🔄 Attempting to reconnect to Arduino...');
    connectArduino();
  }, 5000);
}

connectArduino();

// --- WebSocket Event Loop ---
io.on('connection', (socket) => {
  console.log(`💻 Dashboard connected. ID: ${socket.id}`);

  // Send current arduino status on connect
  socket.emit('arduino-status', {
    connected: arduinoSerial?.isOpen ?? false,
    port: ARDUINO_PORT
  });

  socket.on('send-command', (commandCharacter) => {
    if (!arduinoSerial || !arduinoSerial.isOpen) {
      console.warn(`⚠️ Command '${commandCharacter}' dropped. Serial not open.`);
      socket.emit('system-log', '[SERVER] Cannot send command — Arduino disconnected.');
      return;
    }
    console.log(`📤 Command: [${commandCharacter}]`);
    arduinoSerial.write(commandCharacter, (err) => {
      if (err) console.error(`❌ Write error: ${err.message}`);
    });
  });

  socket.on('disconnect', () => {
    console.log(`❌ Dashboard disconnected. ID: ${socket.id}`);
  });
});

// --- Boot ---
const PORT = 5000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
