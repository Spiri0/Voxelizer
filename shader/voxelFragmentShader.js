import { wgslFn } from "three/tsl";


export const voxelFragmentShader = wgslFn(`
	fn main_vertex(
		voxelColorBuffer: ptr<storage, array<vec4<f32>>, read>,
		instanceIndex: u32,
	) -> vec4<f32> {

		return voxelColorBuffer[ instanceIndex ];

	}
`);