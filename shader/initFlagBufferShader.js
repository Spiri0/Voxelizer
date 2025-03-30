import { wgslFn } from "three/tsl";


export const initFlagBufferShader = wgslFn(`
	fn compute(
		changedFlagBuffer: ptr<storage, FlagBuffer, read_write>,
	) -> void {

		changedFlagBuffer.x = 0;
		atomicStore(&changedFlagBuffer.y, 0);
	}
`);
