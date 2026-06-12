# Atwood Machine Telemetry System

This repository contains the firmware and architecture for an automated, high-precision telemetry system designed to measure acceleration and mass characteristics on an Atwood Machine. The project bridges physical instrumentation with digital processing, utilizing real-time sensor integration and interrupt-driven timing mechanics.

---

##  Hardware Architecture & Components

The telemetry system interfaces directly with microcontrollers and custom physical circuits, processing real-time signals from the following hardware stack:
*   **Microcontroller:** Arduino architecture utilizing optimized C++ firmware.
*   **Mass Measurement:** HX11 Load Cell amplifier for precise weight calibration and real-time load logging.
*   **Time-of-Flight Telemetry:** Infrared (IR) Timing Gates configured to capture velocity and acceleration vectors.
*   **Electronics Infrastructure:** Custom-soldered circuitry designed to manage noise isolation and stable telemetry feeds.

---

##  Engineering & Firmware Features

### 1. Interrupt-Driven Timing Gates
*   Implemented precise time-of-flight logging using low-level hardware interrupts. 
*   By bypassing standard looping bottlenecks, the microcontroller captures precise timestamp data the exact microsecond an object breaks the IR beam, ensuring high-fidelity velocity and acceleration metrics.

### 2. Load Cell Calibration & Filtering
*   Configured the digital interface for the HX711 load cell amplifier.
*   The firmware calibrates raw sensor data into meaningful physical measurements, filtering electrical noise to track dynamic tension and mass changes accurately during physical movement.

### 3. Streamlined Data Pipelines
*   Designed the system to serialize raw sensor data and stream it efficiently over serial communication, formatting the output so it can easily be ingested by data visualization or mathematical modeling scripts.

---

##  Core Repository Structure

*   `/src` – Core C++ (`.ino` / `.cpp`) firmware files handling sensor loops and hardware configuration.
*   `/schematics` – Electrical layouts and wiring diagrams for the instrumentation setup.

---

##  Future System Roadmaps
*   **Wireless Data Streaming:** Integrating ESP32/Bluetooth modules to transmit real-time telemetry data wirelessly to a live web dashboard.
*   **Edge Calculations:** Moving higher-level kinematic modeling directly onto the microcontroller for real-time edge processing.
