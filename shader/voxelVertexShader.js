import { wgslFn } from "three/tsl";


export const voxelVertexShader = wgslFn(`
	fn main_vertex(
		projectionMatrix: mat4x4<f32>,
		cameraViewMatrix: mat4x4<f32>,
		modelWorldMatrix: mat4x4<f32>,
		instanceIndex: u32,
		vertexIndex: u32,
		positions: ptr<storage, array<vec3<f32>>, read>,
		voxelPositionBuffer: ptr<storage, array<vec3<f32>>, read>,
		voxelInfoBuffer: ptr<storage, array<u32>, read>,
	) -> vec4<f32> {

		var info = voxelInfoBuffer[ instanceIndex ];

		if ( info == 2u ) {
			return vec4<f32>( 0, 1000000.0, 0, 1.0 ); //primitive way to skip unnesseccary voxels
		}

		var position = positions[ vertexIndex ] + voxelPositionBuffer[ instanceIndex ];

		var outPosition = projectionMatrix * cameraViewMatrix * modelWorldMatrix * vec4<f32>( position, 1 );

		return outPosition;
	}
`);