# Web Audio API Noise Meter Architecture

This document provides a comprehensive implementation guide for the client-side noise meter, detailing browser microphone permissions, the Web Audio API lifecycle, frequency bin calculations, and real-time decibel (dB) measurements.

---

## 1. High-Level Architecture Overview

The noise meter functions by capturing hardware microphone input, feeding it through a real-time signal processing graph, and extracting amplitude values to map human-perceivable environmental loudness levels.

The data pipeline flows linearly through the following stages:

[ Hardware Microphone ] 
         │
         ▼
[ MediaStream (Navigator API) ]
         │
         ▼
[ MediaStreamAudioSourceNode ]
         │
         ▼
[ AnalyserNode (Fast Fourier Transform) ]
         │
         ▼
[ Logarithmic Decibel Mapping Loop ] -> [ UI Render Component ]

---

## 2. Browser Permission Handling & Lifecycle

Accessing hardware devices requires user explicit consent via the browser's Permissions API wrapper. Because browsers strictly restrict unauthorized sound capture, the processing lifecycle cannot begin until permissions are resolved.

### Safety & Constraints:
* Autoplay Policies: Modern browsers suspend the audio pipeline automatically unless the creation sequence originates directly from a user gesture (e.g., clicking a "Start Meter" button).
* Secure Contexts: The `getUserMedia` hook is blocked on insecure environments. It requires HTTPS on public domains, or localhost for local testing.

---

## 3. Audio Context & Processing Graph

The framework relies on an isolated environment called the `AudioContext`. Inside this context, custom audio modular nodes are explicitly routed together.

### Core Processing Nodes:
1. MediaStreamAudioSourceNode: Acts as the entry interface that swallows the raw incoming browser hardware track.
2. AnalyserNode: A non-destructive pass-through node that performs real-time Fast Fourier Transform (FFT) analysis to generate frequency and time-domain records without modifying the output stream.

---

## 4. Signal Analysis & Decibel Calculation

The real-time calculation translates raw computational arrays into human-readable decibel sound scales.

### FFT Buffer Sizing
The `AnalyserNode.fftSize` property defines the window size used for frequency analysis. It must be a power of two (e.g., 2048). The number of data bins available for evaluation is always exactly half of the total FFT window size (known as the Nyquist frequency boundary).

### The Math: Root Mean Square (RMS) to Decibels
To measure the overall intensity over a discrete time window, we calculate the Root Mean Square (RMS) of the raw time-domain pulse samples, then map it logarithmically to a decibel scale:

1. RMS Calculation:
   Square each absolute amplitude sample in the array, find the mathematical average of those squared values, and compute the square root of that average.

2. Logarithmic Decibel Conversion:
   Convert the derived average pressure scale into decibel levels using the standard formula:
   dB = 20 * log10(RMS)

Because raw digital audio amplitudes top out at a float ceiling value of 1.0, the computed raw dB values represent a negative range stretching downwards from 0 dBFS (Decibels relative to Full Scale) towards negative infinity. A soft noise floor multiplier is added inline within the rendering system to normalize these metrics for standard UI layouts.

---

## 5. Complete Architecture Code Snippet

The following standalone JavaScript structure represents the foundational pipeline pattern used to implement the noise tracking cycle:

// Main processing loop wrapper encapsulation
async function initializeNoiseMeter() {
  try {
    // 1. Request hardware capture constraints from user
    const stream = await navigator.mediaDevices.getUserMedia({ 
      audio: { echoCancellation: true, noiseSuppression: false } 
    });

    // 2. Initialize the main processing environment 
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const audioContext = new AudioContextClass();
    
    // 3. Construct modular graph nodes
    const sourceNode = audioContext.createMediaStreamSource(stream);
    const analyserNode = audioContext.createAnalyser();
    
    // 4. Set FFT resolution configuration parameters
    analyserNode.fftSize = 2048;
    const bufferLength = analyserNode.fftSize;
    const dataArray = new Float32Array(bufferLength);
    
    // 5. Connect node streams sequentially
    sourceNode.connect(analyserNode);
    
    console.log("Audio processing architecture successfully connected.");

    // 6. Define tracking cycle loop
    function calculateVolume() {
      // Pull raw audio waveform timeline values into local float array
      analyserNode.getFloatTimeDomainData(dataArray);
      
      let sumSquares = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sumSquares += dataArray[i] * dataArray[i];
      }
      
      const rms = Math.sqrt(sumSquares / dataArray.length);
      
      // Enforce lower bound safety baseline check to avoid log10(0) evaluation errors
      const safeFloor = 0.00001;
      const currentRMS = rms > safeFloor ? rms : safeFloor;
      
      // Logarithmic evaluation conversion scale mapping
      let decibels = 20 * Math.log10(currentRMS);
      
      // Normalize dynamic scale range to a positive 0-100 UI mapping spectrum
      let normalizedVolume = Math.max(0, Math.min(100, Math.round(decibels + 100)));
      
      console.log("Real-time sound level volume:", normalizedVolume);
      
      // Request next frame execution cycle from window manager
      requestAnimationFrame(calculateVolume);
    }
    
    // Initiate execution engine cycle loop
    calculateVolume();

  } catch (error) {
    console.error("Microphone hardware configuration permission rejected:", error);
  }
}