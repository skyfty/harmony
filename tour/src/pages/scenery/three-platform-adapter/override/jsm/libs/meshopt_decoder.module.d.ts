import { MeshoptDecoder as _MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module';

export const MeshoptDecode: typeof _MeshoptDecoder & {
  dispose: () => void;
  useWorker: (count: number) => void;
  decodeGltfBufferAsync: (
    count: number,
    size: number,
    source: Uint8Array,
    mode: string,
    filter?: string
  ) => Promise<Uint8Array>;
};
