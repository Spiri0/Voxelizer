import { wgslFn } from "three/tsl";


export const voxelSurfaceShader = wgslFn(`
	fn compute(
		voxelPositionBuffer: ptr<storage, array<vec3<f32>>, read_write>,
		voxelInfoBuffer: ptr<storage, array<u32>, read_write>,
		voxelColorBuffer: ptr<storage, array<vec4<f32>>, read_write>,
		indexBuffer: ptr<storage, array<u32>, read_write>,
		positions: ptr<storage, array<vec3<f32>>, read_write>,
		normals: ptr<storage, array<vec3<f32>>, read_write>,
		gridSize: vec3<f32>,
		boundingBoxMin: vec3<f32>,
		boundingBoxMax: vec3<f32>,
		voxelSize: f32,
		positionsLength: u32,
		indicesLength: u32,
		index: u32,
	) -> void {

		var nx = u32(gridSize.x);
		var ny = u32(gridSize.y);
		var nz = u32(gridSize.z);

		let x = index % nx;
		let y = (index / nx) % ny;
		let z = (index / (nx * ny)) % nz;

		let voxelCenter = boundingBoxMin + vec3<f32>(f32(x), f32(y), f32(z)) * voxelSize + vec3<f32>(0.5 * voxelSize);


		var isSurface = false;

		let voxelMin = voxelCenter - 0.5 * voxelSize;
		let voxelMax = voxelCenter + 0.5 * voxelSize;

		for (var i = 0u; i < indicesLength; i += 3) {
			let i0 = indexBuffer[i];
			let i1 = indexBuffer[i + 1];
			let i2 = indexBuffer[i + 2];

			let v0 = positions[i0];
			let v1 = positions[i1];
			let v2 = positions[i2];

			if ( triangle_intersects_voxel( v0, v1, v2, voxelCenter, voxelMin, voxelMax ) ) {
				isSurface = true;
				break;
			}
		}


		voxelColorBuffer[index] = vec4<f32>(1, 0.5, 0, 1);


		if (isOnBoundary(x, y, z, nx, ny, nz)) {
			voxelInfoBuffer[index] = 2;
			voxelColorBuffer[index] = vec4<f32>(1, 0, 0, 1);
		}

		if (isSurface) {
			voxelInfoBuffer[index] = 1;
			voxelColorBuffer[index] = vec4<f32>(0, 1, 0, 1);
		}

		voxelPositionBuffer[index] = voxelCenter;

	}


	fn isOnBoundary(x: u32, y: u32, z: u32, nx: u32, ny: u32, nz: u32) -> bool {
		return (x == 0 || x == nx - 1 || y == 0 || y == ny - 1 || z == 0 || z == nz - 1);
	}


	fn triangle_intersects_voxel( v0: vec3<f32>, v1: vec3<f32>, v2: vec3<f32>, voxelCenter: vec3<f32>, voxelMin: vec3<f32>, voxelMax: vec3<f32> ) -> bool {

		let halfSize = ( voxelMax - voxelMin ) * 0.5;

		let tv0 = v0 - voxelCenter;
		let tv1 = v1 - voxelCenter;
		let tv2 = v2 - voxelCenter;

		//triangle base vectors ( triangle sides )
		let e0 = tv1 - tv0;
		let e1 = tv2 - tv1;
		let e2 = tv0 - tv2;

		let voxelAxes = array<vec3<f32>, 3>(
			vec3<f32>( 1.0, 0.0, 0.0 ),
			vec3<f32>( 0.0, 1.0, 0.0 ),
			vec3<f32>( 0.0, 0.0, 1.0 )
		);

        for ( var i = 0u; i < 3u; i = i + 1u ) {
			let axis = voxelAxes[i];

			let r = halfSize[i];
			let p0 = dot( tv0, axis );
			let p1 = dot( tv1, axis );
			let p2 = dot( tv2, axis );

			let minP = min( p0, min( p1, p2 ) );
			let maxP = max( p0, max( p1, p2 ) );

			if ( minP > r || maxP < -r ) {
				return false;
			}
		}


		let triangleNormal = cross( e0, e1 );
		let triangleOffset = dot( triangleNormal, tv0 );

		if ( abs( triangleOffset ) > dot( halfSize, abs( triangleNormal ) ) ) {
			return false;
		}


		for ( var i = 0u; i < 3u; i = i + 1u ) {
			let axisX = cross( voxelAxes[i], e0 );
			let axisY = cross( voxelAxes[i], e1 );
			let axisZ = cross( voxelAxes[i], e2 );

			if ( !check_separating_axis(axisX, tv0, tv1, tv2, halfSize ) ||
				!check_separating_axis(axisY, tv0, tv1, tv2, halfSize ) ||
				!check_separating_axis(axisZ, tv0, tv1, tv2, halfSize ) ) {
				return false;
			}
		}

		return true;
	}


	fn check_separating_axis(axis: vec3<f32>, v0: vec3<f32>, v1: vec3<f32>, v2: vec3<f32>, halfSize: vec3<f32>) -> bool {

		let r = dot(halfSize, abs(axis));
		let p0 = dot(v0, axis);
		let p1 = dot(v1, axis);
		let p2 = dot(v2, axis);

		let minP = min(p0, min(p1, p2));
		let maxP = max(p0, max(p1, p2));

		return !(minP > r || maxP < -r);
	}

`);