type SharedOrRegularBuffer = SharedArrayBuffer | ArrayBuffer;

const READ_INDEX_SLOT = 0;
const WRITE_INDEX_SLOT = 1;
const INDEX_SLOT_COUNT = 2;
const MAX_CAPACITY = 0x3fffffff;

export class AudioRingBuffer {
  public readonly capacity: number;
  public readonly sampleStorage: SharedOrRegularBuffer;
  public readonly indexStorage: SharedOrRegularBuffer;
  public readonly samples: Float32Array;
  public readonly indices: Int32Array;
  public readonly usesSharedMemory: boolean;

  private readonly indexCapacity: number;
  private readonly canUseAtomics: boolean;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError('AudioRingBuffer capacity must be a positive integer.');
    }

    if (capacity > MAX_CAPACITY) {
      throw new RangeError(`AudioRingBuffer capacity must be <= ${MAX_CAPACITY}.`);
    }

    this.capacity = capacity;
    this.indexCapacity = capacity * 2;
    this.usesSharedMemory = typeof SharedArrayBuffer === 'function';
    this.canUseAtomics = this.usesSharedMemory && typeof Atomics !== 'undefined';

    const SampleBufferCtor = this.usesSharedMemory ? SharedArrayBuffer : ArrayBuffer;
    const IndexBufferCtor = this.usesSharedMemory ? SharedArrayBuffer : ArrayBuffer;

    this.sampleStorage = new SampleBufferCtor(capacity * Float32Array.BYTES_PER_ELEMENT);
    this.indexStorage = new IndexBufferCtor(INDEX_SLOT_COUNT * Int32Array.BYTES_PER_ELEMENT);
    this.samples = new Float32Array(this.sampleStorage);
    this.indices = new Int32Array(this.indexStorage);

    this.storeIndex(READ_INDEX_SLOT, 0);
    this.storeIndex(WRITE_INDEX_SLOT, 0);
  }

  availableRead(): number {
    const readIndex = this.loadIndex(READ_INDEX_SLOT);
    const writeIndex = this.loadIndex(WRITE_INDEX_SLOT);

    return this.computeAvailableRead(readIndex, writeIndex);
  }

  availableWrite(): number {
    return this.capacity - this.availableRead();
  }

  reset(): void {
    this.storeIndex(READ_INDEX_SLOT, 0);
    this.storeIndex(WRITE_INDEX_SLOT, 0);
  }

  push(data: Float32Array): boolean {
    const frameCount = data.length;

    if (frameCount === 0) {
      return true;
    }

    const readIndex = this.loadIndex(READ_INDEX_SLOT);
    const writeIndex = this.loadIndex(WRITE_INDEX_SLOT);
    const freeSpace = this.capacity - this.computeAvailableRead(readIndex, writeIndex);

    if (frameCount > freeSpace) {
      return false;
    }

    let sampleIndex = this.toSampleIndex(writeIndex);
    let remainingToEnd = this.capacity - sampleIndex;

    if (frameCount <= remainingToEnd) {
      for (let index = 0; index < frameCount; index += 1) {
        this.samples[sampleIndex + index] = data[index];
      }
    } else {
      for (let index = 0; index < remainingToEnd; index += 1) {
        this.samples[sampleIndex + index] = data[index];
      }

      const wrappedCount = frameCount - remainingToEnd;
      sampleIndex = 0;

      for (let index = 0; index < wrappedCount; index += 1) {
        this.samples[sampleIndex + index] = data[remainingToEnd + index];
      }
    }

    this.storeIndex(WRITE_INDEX_SLOT, this.advanceIndex(writeIndex, frameCount));
    return true;
  }

  pull(output: Float32Array): number {
    const requestedFrames = output.length;

    if (requestedFrames === 0) {
      return 0;
    }

    const readIndex = this.loadIndex(READ_INDEX_SLOT);
    const writeIndex = this.loadIndex(WRITE_INDEX_SLOT);
    const availableFrames = this.computeAvailableRead(readIndex, writeIndex);
    const framesToRead = requestedFrames < availableFrames ? requestedFrames : availableFrames;

    if (framesToRead > 0) {
      let sampleIndex = this.toSampleIndex(readIndex);
      let remainingToEnd = this.capacity - sampleIndex;

      if (framesToRead <= remainingToEnd) {
        for (let index = 0; index < framesToRead; index += 1) {
          output[index] = this.samples[sampleIndex + index];
        }
      } else {
        for (let index = 0; index < remainingToEnd; index += 1) {
          output[index] = this.samples[sampleIndex + index];
        }

        const wrappedCount = framesToRead - remainingToEnd;
        sampleIndex = 0;

        for (let index = 0; index < wrappedCount; index += 1) {
          output[remainingToEnd + index] = this.samples[sampleIndex + index];
        }
      }

      this.storeIndex(READ_INDEX_SLOT, this.advanceIndex(readIndex, framesToRead));
    }

    if (framesToRead < requestedFrames) {
      output.fill(0, framesToRead);
    }

    return framesToRead;
  }

  private computeAvailableRead(readIndex: number, writeIndex: number): number {
    return writeIndex >= readIndex
      ? writeIndex - readIndex
      : this.indexCapacity - readIndex + writeIndex;
  }

  private advanceIndex(currentIndex: number, delta: number): number {
    const nextIndex = currentIndex + delta;

    return nextIndex >= this.indexCapacity
      ? nextIndex - this.indexCapacity
      : nextIndex;
  }

  private toSampleIndex(index: number): number {
    return index < this.capacity ? index : index - this.capacity;
  }

  private loadIndex(slot: number): number {
    if (this.canUseAtomics) {
      return Atomics.load(this.indices, slot);
    }

    return this.indices[slot];
  }

  private storeIndex(slot: number, value: number): void {
    if (this.canUseAtomics) {
      Atomics.store(this.indices, slot, value);
      return;
    }

    this.indices[slot] = value;
  }
}
