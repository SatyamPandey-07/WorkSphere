declare module "qrcode.react" {
  const QRCodeSVG: any;
  const QRCodeCanvas: any;
  export { QRCodeSVG, QRCodeCanvas };
  export default QRCodeSVG;
}

declare module "html-to-image" {
  export function toSvg(node: any, options?: any): Promise<string>;
  export function toPng(node: any, options?: any): Promise<string>;
  export function toJpeg(node: any, options?: any): Promise<string>;
  export function toBlob(node: any, options?: any): Promise<Blob | null>;
  export function toPixelData(node: any, options?: any): Promise<Uint8ClampedArray>;
}

declare module "*.vert?raw" {
  const content: string;
  export default content;
}

declare module "*.frag?raw" {
  const content: string;
  export default content;
}

declare module "*?raw" {
  const content: string;
  export default content;
}

declare module "*.wasm" {
  const content: any;
  export default content;
}

declare module "@/wasm/*" {
  const content: any;
  export default content;
}

declare module "@/shaders/*" {
  const content: string;
  export default content;
}

declare module "@/lib/wasm-loader/*" {
  const mod: any;
  export default mod;
  export const initWasm: any;
  export const runVAD: any;
  export const initEyeTracker: any;
  export const processEyeGaze: any;
  export const scoreFatigue: any;
  export const computePERCLOS: any;
  export const compress: any;
  export const decompress: any;
}

interface AudioParam {
  readonly context: BaseAudioContext;
}

interface DeviceOrientationEvent {
  readonly rotationRate?: DeviceMotionEventRotationRate | null;
}

// AudioWorklet globals
interface AudioWorkletProcessorImpl {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean;
}

declare class AudioWorkletProcessor implements AudioWorkletProcessorImpl {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: any) => any
): void;

declare const sampleRate: number;
declare const currentTime: number;
declare const currentFrame: number;

interface AudioWorkletGlobalScope {
  readonly currentFrame: number;
  readonly currentTime: number;
  readonly sampleRate: number;
  registerProcessor(name: string, processorCtor: new (options?: any) => any): void;
}

interface XRSession {
  lightEstimation?: any;
}

// WebXR Depth & Light Estimation
interface XRDepthInformation {
  readonly width: number;
  readonly height: number;
  readonly normDepthBufferFromNormView: {
    readonly matrix: Float32Array;
  };
  readonly rawValueToMeters: number;
  getDepthInMeters(x: number, y: number): number;
}

interface XRCPUDepthInformation extends XRDepthInformation {
  readonly data: ArrayBuffer;
}

interface XRWebGLDepthInformation extends XRDepthInformation {
  readonly texture: WebGLTexture;
}

interface XRLightEstimate {
  readonly sphericalHarmonicsCoefficients?: Float32Array;
  readonly primaryLightDirection?: DOMPointReadOnly;
  readonly primaryLightIntensity?: DOMPointReadOnly;
}

interface XRLightProbe extends EventTarget {
  readonly probeSpace: any;
  onreflectionchange?: (ev: Event) => any;
}

// Web Bluetooth Types
interface BluetoothDevice extends EventTarget {
  id: string;
  name?: string;
  gatt?: BluetoothRemoteGATTServer;
  watchAdvertisements?: () => Promise<void>;
  unwatchAdvertisements?: () => void;
  watchingAdvertisements?: boolean;
}

interface BluetoothRemoteGATTServer {
  device: BluetoothDevice;
  connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: number | string): Promise<BluetoothRemoteGATTService>;
  getPrimaryServices(service?: number | string): Promise<BluetoothRemoteGATTService[]>;
}

interface BluetoothRemoteGATTService {
  device: BluetoothDevice;
  uuid: string;
  isPrimary: boolean;
  getCharacteristic(characteristic: number | string): Promise<BluetoothRemoteGATTCharacteristic>;
  getCharacteristics(characteristic?: number | string): Promise<BluetoothRemoteGATTCharacteristic[]>;
}

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  service: BluetoothRemoteGATTService;
  uuid: string;
  properties: {
    broadcast: boolean;
    read: boolean;
    writeWithoutResponse: boolean;
    write: boolean;
    notify: boolean;
    indicate: boolean;
    authenticatedSignedWrites: boolean;
    reliableWrite: boolean;
    writableAuxiliaries: boolean;
  };
  value?: DataView;
  getDescriptor(descriptor: number | string): Promise<BluetoothRemoteGATTDescriptor>;
  getDescriptors(descriptor?: number | string): Promise<BluetoothRemoteGATTDescriptor[]>;
  readValue(): Promise<DataView>;
  writeValue(value: BufferSource): Promise<void>;
  writeValueWithResponse(value: BufferSource): Promise<void>;
  writeValueWithoutResponse(value: BufferSource): Promise<void>;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTDescriptor {
  characteristic: BluetoothRemoteGATTCharacteristic;
  uuid: string;
  value?: DataView;
  readValue(): Promise<DataView>;
  writeValue(value: BufferSource): Promise<void>;
}

interface BluetoothLEScan {
  keepRepeats: boolean;
  acceptAllAdvertisements: boolean;
  active: boolean;
  stop(): void;
}

interface BluetoothAdvertisingEvent extends Event {
  device: BluetoothDevice;
  rssi?: number;
  txPower?: number;
  uuids?: string[];
  serviceData?: Map<string, DataView>;
  manufacturerData?: Map<number, DataView>;
}

interface Bluetooth extends EventTarget {
  getAvailability(): Promise<boolean>;
  requestDevice(options?: any): Promise<BluetoothDevice>;
  requestLEScan?(options?: any): Promise<BluetoothLEScan>;
  addEventListener(type: string, listener: (this: this, ev: any) => any, useCapture?: boolean): void;
  removeEventListener(type: string, listener: (this: this, ev: any) => any, useCapture?: boolean): void;
}

interface Navigator {
  bluetooth?: Bluetooth;
}
