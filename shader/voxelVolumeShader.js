import { wgslFn } from "three/tsl";


export const voxelVolumeShader = wgslFn(`
    fn compute(
        voxelPositionBuffer: ptr<storage, array<vec3<f32>>, read_write>,
        voxelInfoBuffer: ptr<storage, array<u32>, read_write>,
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



        var leftFound = false;
        var rightFound = false;

        for (var i = 1u; i < nx; i = i + 1u) {
            let leftIndex = index - i;
            let rightIndex = index + i;

            if (x >= i && voxelInfoBuffer[leftIndex] == 1) {
                leftFound = true;
            }
            if (x + i < nx && voxelInfoBuffer[rightIndex] == 1) {
                rightFound = true;
            }
            if (leftFound && rightFound) {
                break;
            }
        }

        var bottomFound = false;
        var topFound = false;

        for (var j = 1u; j < ny; j = j + 1u) {
            let bottomIndex = index - j * nx;
            let topIndex = index + j * nx;

            if (y >= j && voxelInfoBuffer[bottomIndex] == 1) {
                bottomFound = true;
            }
            if (y + j < ny && voxelInfoBuffer[topIndex] == 1) {
                topFound = true;
            }
            if (bottomFound && topFound) {
                break;
            }
        }

        var frontFound = false;
        var backFound = false;

        for (var k = 1u; k < nz; k = k + 1u) {
            let frontIndex = index - k * nx * ny;
            let backIndex = index + k * nx * ny;

            if (z >= k && voxelInfoBuffer[frontIndex] == 1) {
                frontFound = true;
            }
            if (z + k < nz && voxelInfoBuffer[backIndex] == 1) {
                backFound = true;
            }
            if (frontFound && backFound) {
                break;
            }
        }


        if (leftFound && rightFound && bottomFound && topFound && frontFound && backFound && voxelInfoBuffer[ index ] == 0u ) {
            voxelInfoBuffer[ index ] = 1u;
            voxelColorBuffer[ index ] = vec4<f32>( 1, 0.5, 0, 1 );
        }

    }
`);