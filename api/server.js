import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';

const app = express();
const httpServer = createServer(app);

// Setup Socket.io with CORS enabled so your React app (usually port 3000 or 5173) can talk to it
const io = new Server(httpServer, {
  cors: {
    origin: "*", // Allows any frontend origin to connect during development
    methods: ["GET", "POST"]
  }
});

// --- Hardware Serial Configuration ---
const ARDUINO_PORT = 'COM11'; // <-- CHANGE THIS to your exact Arduino COM port!
const BAUD_RATE = 115200;

let arduinoSerial = null;

try {
  // Initialize Serial Port connection
  arduinoSerial = new SerialPort({
    path: ARDUINO_PORT,
    baudRate: BAUD_RATE,
    autoOpen: true
  });

  console.log(`📡 Attempting to connect to Arduino on port ${ARDUINO_PORT}...`);
} catch (error) {
  console.error(`❌ Critical error initializing serial port: ${error.message}`);
}

// Pipe the raw serial data through a Readline parser to split chunks cleanly by trailing newlines (\n)
const parser = arduinoSerial ? arduinoSerial.pipe(new ReadlineParser({ delimiter: '\n' })) : null;

if (arduinoSerial) {
  arduinoSerial.on('open', () => {
    console.log(`✅ Serial Connection Established successfully at ${BAUD_RATE} baud.`);
  });

  arduinoSerial.on('error', (err) => {
    console.error(`⚠️ Serial Port Error: ${err.message}`);
    io.emit('hardware-error', `Serial Port Error: ${err.message}`);
  });
}

// --- Data Routing Architecture ---

if (parser) {
  // Listen for parsed, clean lines coming directly from the Arduino
  parser.on('data', (dataLine) => {
    const cleanData = dataLine.trim();
    if (!cleanData) return;

    // Check if the incoming string is a specialized event token from our interrupts
    if (cleanData.startsWith('EVENT_DYNAMIC_RUN:')) {
      const timePayload = cleanData.split(':')[1];
      console.log(`⏱️ Dynamic Run Triggered! Time of flight: ${timePayload} ms`);
      
      // Broadcast the high-priority event string out to the React client dashboard
      io.emit('dynamic-run-captured', parseFloat(timePayload));
    } 
    else if (cleanData.includes('Sampling...') || cleanData.includes('>>>') || cleanData.includes('---')) {
      // Catch terminal text logging coming out of the Arduino's test loop and forward as a status log
      io.emit('system-log', cleanData);
    }
    else {
      // Treat standard data packets as real-time telemetry streaming (e.g., live countdown messages)
      io.emit('telemetry', cleanData);
    }
  });
}

// --- WebSocket Event Loop (React to Server Commands) ---
io.on('connection', (socket) => {
  console.log(`💻 React Dashboard client linked up. ID: ${socket.id}`);

  // Forward instructions received from the web dashboard directly down the USB pipeline to the Arduino
  socket.on('send-command', (commandCharacter) => {
    if (!arduinoSerial || !arduinoSerial.isOpen) {
      console.warn(`⚠️ Command '${commandCharacter}' dropped. Serial interface is not open.`);
      socket.emit('system-log', '[SERVER ERROR] Cannot send command. Arduino disconnected.');
      return;
    }

    console.log(`📤 Web dashboard fired instruction: [${commandCharacter}]`);
    
    // Write character directly to the micro-controller buffer
    arduinoSerial.write(commandCharacter, (err) => {
      if (err) {
        console.error(`❌ Error writing to serial buffer: ${err.message}`);
      }
    });
  });

  socket.on('disconnect', () => {
    console.log(`❌ React Dashboard client disconnected. ID: ${socket.id}`);
  });
});

// --- Boot Server Block ---
const PORT = 5000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Back-end relay agent spinning up at http://localhost:${PORT}`);
});