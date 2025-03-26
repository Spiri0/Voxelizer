/**
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */


import * as THREE from "three";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { wgslFn, vec4, uniform, instanceIndex, vertexIndex, storage, uint } from "three/tsl";
import { cameraProjectionMatrix, modelWorldMatrix, cameraViewMatrix } from "three/tsl";
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';


class App {
	constructor() {
	}

	async init( canvas ) {

		this.renderer = new THREE.WebGPURenderer( { 
			canvas: canvas,
			antialias: true
		} );

		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.renderer.setPixelRatio( window.devicePixelRatio );
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		this.renderer.physicallyCorrectLights = true;
		this.renderer.domElement.id = 'threejs';
		this.renderer.setSize( window.innerWidth, window.innerHeight );
		this.renderer.setClearColor( 0x000000 );

		await this.renderer.init();

		this.scene = new THREE.Scene();
		this.scene.background = new THREE.Color( 0x00001f );
		this.camera = new THREE.PerspectiveCamera( 50, window.innerWidth / window.innerHeight, 0.01, 1e6 );
		this.camera.position.set( 100, 50, 100 );
		this.controls = new OrbitControls( this.camera, this.renderer.domElement );
		this.controls.target.set( 0, 0, 0 );
		this.controls.update();

		window.renderer = this.renderer;
		window.scene = this.scene;
		window.camera = this.camera;

		//--------------------------------------------------------------------------------------------------

		const ship = await this.loadModel( './resources/models/CVE.glb' );

		const shipBoundingBox = new THREE.Box3().setFromObject( ship );
		const gridSize = new THREE.Vector3();
		shipBoundingBox.getSize( gridSize );


		const mergedShipModel = this.extractMergedGeometry( ship );


		const feetToMeter = 0.3048;
		const voxelSize = 0.5 / feetToMeter;

		const nx = Math.ceil( gridSize.x / voxelSize );
		const ny = Math.ceil( gridSize.y / voxelSize );
		const nz = Math.ceil( gridSize.z / voxelSize );

		console.log(nx);
		console.log(ny);
		console.log(nz);

		const voxelcount = nx * ny * nz;


		const voxelSurfaceShader = wgslFn(`
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

				//------------------------------------------------------------------------------------------------------------

				var nx = u32(gridSize.x);
				var ny = u32(gridSize.y);
				var nz = u32(gridSize.z);

				let x = index % nx;
				let y = (index / nx) % ny;
				let z = (index / (nx * ny)) % nz;

				let voxelCenter = boundingBoxMin + vec3<f32>(f32(x), f32(y), f32(z)) * voxelSize + vec3<f32>(0.5 * voxelSize);

				//------------------------------------------------------------------------------------------------------------

				var visible = false;

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
						visible = true;
						break;
					}
				}


				voxelInfoBuffer[ index ] = select( u32(0), u32(1), visible );
				voxelPositionBuffer[ index ] = voxelCenter;
				voxelColorBuffer[ index ] = vec4<f32>( 0, 1, 0, 1 );

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


		const voxelVolumeShader = wgslFn(`
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
					let leftIndex = index - i;  // Voxel links
					let rightIndex = index + i; // Voxel rechts

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
					let bottomIndex = index - j * nx;  // Voxel unten
					let topIndex = index + j * nx;     // Voxel oben

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
					let frontIndex = index - k * nx * ny;  // Voxel vorne
					let backIndex = index + k * nx * ny;   // Voxel hinten

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


		const voxelPositionBuffer = new THREE.StorageBufferAttribute( new Float32Array( voxelcount * 3 ), 3 );
		const voxelColorBuffer = new THREE.StorageBufferAttribute( new Float32Array( voxelcount * 4 ), 4 );
		const voxelInfoBuffer = new THREE.StorageBufferAttribute( new Uint32Array( voxelcount ), 1 );
		const positionBuffer = new THREE.StorageBufferAttribute( new Float32Array( mergedShipModel.positions ), 3 );
		const normalBuffer = new THREE.StorageBufferAttribute( new Float32Array( mergedShipModel.normals ), 3 );
		const indexBuffer = new THREE.StorageBufferAttribute( new Uint32Array( mergedShipModel.indices ), 1 );

		const voxelSurfaceCompute = voxelSurfaceShader( {
			voxelPositionBuffer: storage( voxelPositionBuffer, 'vec3', voxelPositionBuffer.count ),
			voxelInfoBuffer: storage( voxelInfoBuffer, 'u32', voxelInfoBuffer.count ),
			voxelColorBuffer: storage( voxelColorBuffer, 'vec4', voxelColorBuffer.count ),
			indexBuffer: storage( indexBuffer, 'u32', indexBuffer.count ),
			positions: storage( positionBuffer, 'vec3', positionBuffer.count ),
			normals: storage( normalBuffer, 'vec3', normalBuffer.count ),
			gridSize: uniform( new THREE.Vector3( nx, ny, nz) ),
			boundingBoxMin: uniform( shipBoundingBox.min ),
			boundingBoxMax: uniform( shipBoundingBox.max ),
			voxelSize: uniform( voxelSize ),
			positionsLength: uniform( uint( positionBuffer.count ) ),
			indicesLength: uniform( uint( indexBuffer.count ) ),
			index: instanceIndex,
		} ).compute( voxelcount );
		this.renderer.compute( voxelSurfaceCompute, [ 8, 8, 8 ] );

		const voxelVolumeCompute = voxelVolumeShader( {
			voxelPositionBuffer: storage( voxelPositionBuffer, 'vec3', voxelPositionBuffer.count ),
			voxelInfoBuffer: storage( voxelInfoBuffer, 'u32', voxelInfoBuffer.count ),
			voxelColorBuffer: storage( voxelColorBuffer, 'vec4', voxelColorBuffer.count ),
			gridSize: uniform( new THREE.Vector3( nx, ny, nz) ),
			index: instanceIndex,
		} ).compute( voxelcount );
		this.renderer.compute( voxelVolumeCompute, [ 8, 8, 8 ] );

		//------------------------------------------------------------------------------------------------------------

		//Now visualizing the voxels

		const voxel = new THREE.BoxGeometry( voxelSize, voxelSize, voxelSize );
		const voxelGeometry = new THREE.InstancedBufferGeometry();
		voxelGeometry.instanceCount = voxelcount;
		voxelGeometry.setIndex( new THREE.BufferAttribute( voxel.index.array, 1 ) );

		//instead of an attribute I use a buffer
		const voxelVerticePositionBuffer = new THREE.StorageBufferAttribute( voxel.attributes.position.array, 3 );


		const voxelVertexShader = wgslFn(`
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

				if ( info == 0u ) {
					return vec4<f32>( 0, 1000000.0, 0, 1.0 ); //primitive way to skip unnesseccary voxels
				}

				var position = positions[ vertexIndex ] + voxelPositionBuffer[ instanceIndex ];

				var outPosition = projectionMatrix * cameraViewMatrix * modelWorldMatrix * vec4<f32>( position, 1 );

				return outPosition;
			}
		`);


		const voxelFragmentShader = wgslFn(`
			fn main_vertex(
				voxelColorBuffer: ptr<storage, array<vec4<f32>>, read>,
				instanceIndex: u32,
			) -> vec4<f32> {

				return voxelColorBuffer[ instanceIndex ];

			//	return vec4<f32>( 1, 0.5, 0, 1 );
			}
		`);


		const voxelVertexShaderParams = {
			projectionMatrix: cameraProjectionMatrix,
			cameraViewMatrix: cameraViewMatrix,
			modelWorldMatrix: modelWorldMatrix,
			instanceIndex: instanceIndex,
			vertexIndex: vertexIndex,
			positions: storage( voxelVerticePositionBuffer, 'vec3', voxelVerticePositionBuffer ).toReadOnly(),
			voxelPositionBuffer: storage( voxelPositionBuffer, 'vec3', voxelPositionBuffer.count ).toReadOnly(),
			voxelInfoBuffer: storage( voxelInfoBuffer, 'u32', voxelInfoBuffer.count ).toReadOnly()
		}


		const voxelFragmentShaderParams = {
			instanceIndex: instanceIndex,
			voxelColorBuffer: storage( voxelColorBuffer, 'vec4', voxelColorBuffer.count ).toReadOnly()
		}


		const voxelMaterial = new THREE.MeshBasicNodeMaterial();
		voxelMaterial.vertexNode = voxelVertexShader( voxelVertexShaderParams );
		voxelMaterial.fragmentNode = voxelFragmentShader( voxelFragmentShaderParams );
		voxelMaterial.wireframe = true;

		const voxelMesh = new THREE.Mesh( voxelGeometry, voxelMaterial );

		//-------------------------------------------------------------------------------------------

		//Visualize the merged ship geometry

		const mergedModelVertexShader = wgslFn(`
			fn main_vertex(
				projectionMatrix: mat4x4<f32>,
				cameraViewMatrix: mat4x4<f32>,
				modelWorldMatrix: mat4x4<f32>,
				vertexIndex: u32,
				positions: ptr<storage, array<vec3<f32>>, read>,
				indices: ptr<storage, array<u32>, read>,
			) -> vec4<f32> {

				var index = indices[ vertexIndex ];

				var position = positions[ index ];

				var outPosition = projectionMatrix * cameraViewMatrix * modelWorldMatrix * vec4<f32>( position, 1 );

				return outPosition;
			}
		`);

		const modelShaderParams = {
			projectionMatrix: cameraProjectionMatrix,
			cameraViewMatrix: cameraViewMatrix,
			modelWorldMatrix: modelWorldMatrix,
			vertexIndex: vertexIndex,
			positions: storage( positionBuffer, 'vec3', positionBuffer.count ).toReadOnly(),
			indices: storage( indexBuffer, 'uint', indexBuffer.count ).toReadOnly(),
		}

		const indices = [];
		for( let i = 0; i < mergedShipModel.positions.length; i ++ ){
			indices.push(i);
		}

		const mergedGeometry = new THREE.BufferGeometry();
		mergedGeometry.setIndex( new THREE.BufferAttribute( new Uint32Array( indices ), 1 ) );

		const modelMaterial = new THREE.MeshBasicNodeMaterial();
		modelMaterial.vertexNode = mergedModelVertexShader( modelShaderParams );
		modelMaterial.fragmentNode = vec4( 0, 0, 1, 1 );
		modelMaterial.side = THREE.DoubleSide;

		const mergedMesh = new THREE.Mesh( mergedGeometry, modelMaterial );


		//-------------------------------------------------------------------------------------------

		//scene.add( ship );
		scene.add( voxelMesh );
		scene.add( mergedMesh );

		//-------------------------------------------------------------------------------------------

		const ambientLight = new THREE.AmbientLight( 0xffffff, 0.6 );
		scene.add( ambientLight );

		window.addEventListener( "resize", this.onWindowResize, false );

		this.render();

	}


	async loadModel( url ) {
		const loader = new GLTFLoader();
		try {
			const gltf = await loader.loadAsync( url );
			return gltf.scene;
		} catch ( error ) {
			throw error;
		}
	}


	extractMergedGeometry( scene ) {

		const geometries = [];
		let indexOffset = 0;
		const indices = [];

		scene.traverse( ( object ) => {
			if ( object.isMesh ) {
				const geometry = object.geometry.clone();

				if ( geometry.index ) {
					const indexArray = Array.from( geometry.index.array );
					indices.push(...indexArray.map( i => i + indexOffset) );
				} else {
					const numVertices = geometry.attributes.position.count;
					indices.push( ...Array.from( { length: numVertices }, (_, i) => i + indexOffset ) );
				}
				indexOffset += geometry.attributes.position.count;
				geometries.push( geometry );
			}
		} );

		if ( geometries.length === 0 ) return null;

		const mergedGeometry = mergeGeometries( geometries, true );

		const positions = Array.from( mergedGeometry.attributes.position.array );
		const normals = mergedGeometry.attributes.normal ? Array.from( mergedGeometry.attributes.normal.array ) : [];
		const uvs = mergedGeometry.attributes.uv ? Array.from( mergedGeometry.attributes.uv.array ) : [];

		return { positions, normals, uvs, indices };

	}


	render() {

		this.renderer.render( this.scene, this.camera );

		requestAnimationFrame( () => {
			this.render();
		} );

	}


	onWindowResize() {
		this.camera.aspect = window.innerWidth / window.innerHeight;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize( window.innerWidth, window.innerHeight );
	}

}


export { App }
