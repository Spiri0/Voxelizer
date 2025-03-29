import { wgslFn } from "three/tsl";


export const initFlagBufferShader = wgslFn(`
	fn compute(
		changedFlagBuffer: ptr<storage, array<u32>, read_write>,
	) -> void {

		changedFlagBuffer[0] = 0;
	}
`);
