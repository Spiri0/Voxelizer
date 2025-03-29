import { wgslFn } from "three/tsl";


export const voxelVolumeShader = wgslFn(`
	fn compute(
		voxelPositionBuffer: ptr<storage, array<vec3<f32>>, read_write>,
		voxelInfoBuffer: ptr<storage, array<u32>, read_write>,
		changedFlagBuffer: ptr<storage, array<u32>, read_write>,
		voxelColorBuffer: ptr<storage, array<vec4<f32>>, read_write>,
		gridSize: vec3<f32>,
		index: u32,
	) -> void {

		var nx = u32(gridSize.x);
		var ny = u32(gridSize.y);
		var nz = u32(gridSize.z);

		let x = index % nx;
		let y = (index / nx) % ny;
		let z = (index / (nx * ny)) % nz;


		if (x > 0 && x < nx - 1 && y > 0 && y < ny - 1 && z > 0 && z < nz - 1) {
			if (voxelInfoBuffer[index] == 0) { // Unbekanntes Voxel
				if (
					voxelInfoBuffer[ getVoxelIndex(x + 1, y, z, nx, ny) ] == 2 ||
					voxelInfoBuffer[ getVoxelIndex(x - 1, y, z, nx, ny) ] == 2 ||
					voxelInfoBuffer[ getVoxelIndex(x, y + 1, z, nx, ny) ] == 2 ||
					voxelInfoBuffer[ getVoxelIndex(x, y - 1, z, nx, ny) ] == 2 ||
					voxelInfoBuffer[ getVoxelIndex(x, y, z + 1, nx, ny) ] == 2 ||
					voxelInfoBuffer[ getVoxelIndex(x, y, z - 1, nx, ny) ] == 2
				) {
					voxelInfoBuffer[index] = 2;
					changedFlagBuffer[0] = 1;
				}
			}
		}

	}

	fn getVoxelIndex(x: u32, y: u32, z: u32, nx: u32, ny: u32) -> u32 {
		return x + y * nx + z * nx * ny;
	}
`);