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
		const voxelSize = 0.5 / feetToMeter;    //0.25m³

		const nx = Math.ceil( gridSize.x / voxelSize );
		const ny = Math.ceil( gridSize.y / voxelSize );
		const nz = Math.ceil( gridSize.z / voxelSize );

		const voxelcount = nx * ny * nz;


		const voxelShader = wgslFn(`
			fn compute(
				voxelPositionBuffer: ptr<storage, array<vec3<f32>>, read_write>,
				voxelInfoBuffer: ptr<storage, array<u32>, read_write>,
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
				//This part voxels the hole boundingBox volume

				var nx = u32(gridSize.x);
				var ny = u32(gridSize.y);
				var nz = u32(gridSize.z);

				let x = index % nx;
				let y = (index / nx) % ny;
				let z = (index / (nx * ny)) % nz;

				let voxelCenter = boundingBoxMin + vec3<f32>(f32(x), f32(y), f32(z)) * voxelSize + vec3<f32>(0.5 * voxelSize);

				//------------------------------------------------------------------------------------------------------------


				var intersections = 0;

				var ray_dir1 = vec3<f32>(  1.0, 0.0, 0.0 );  // X+
				var ray_dir2 = vec3<f32>( -1.0, 0.0, 0.0 ); // X-

				var visible = false;
				var visible1 = false;
				var visible2 = false;

				for ( var dirIdx = 0u; dirIdx < 6u; dirIdx ++ ) {

					var local_intersections1 = 0;
					var local_intersections2 = 0;

					for (var i = 0u; i < indicesLength; i += 3 ) {

						let i0 = indexBuffer[i];
						let i1 = indexBuffer[i + 1];
						let i2 = indexBuffer[i + 2];

						let v0 = positions[i0];
						let v1 = positions[i1];
						let v2 = positions[i2];

						if ( ray_intersects_triangle( voxelCenter, ray_dir1, v0, v1, v2 ) ) {
							local_intersections1 += 1;
						}
						if ( ray_intersects_triangle( voxelCenter, ray_dir2, v0, v1, v2 ) ) {
							local_intersections2 += 1;
						}
					}

					if ( ( local_intersections1 % 2 ) == 1 ) {
						visible1 = true;
					}
					if ( ( local_intersections2 % 2 ) == 1 ) {
						visible2 = true;
					}
				}


				if( visible1 == true && visible2 == true ){
					visible = true;
				}


				voxelInfoBuffer[ index ] = select( u32(0), u32(1), visible );
				voxelPositionBuffer[ index ] = voxelCenter;

			}


			fn ray_intersects_triangle( ray_origin: vec3<f32>, ray_direction: vec3<f32>, v0: vec3<f32>, v1: vec3<f32>, v2: vec3<f32> ) -> bool {

				let epsilon = 0.0000001;

				let edge1 = v1 - v0;
				let edge2 = v2 - v0;
				let h = cross( ray_direction, edge2 );
				let a = dot( edge1, h );

				if ( a > -epsilon && a < epsilon ) {
					return false; // Ray ist parallel zum Dreieck
				}

				let f = 1.0 / a;
				let s = ray_origin - v0;
				let u = f * dot( s, h );

				if ( u < 0.0 || u > 1.0 ) {
					return false;
				}

				let q = cross( s, edge1 );
				let v = f * dot( ray_direction, q );

				if ( v < 0.0 || u + v > 1.0 ) {
					return false;
				}

				let t = f * dot( edge2, q );
				return t > epsilon;

			}

		`);


		const voxelPositionBuffer = new THREE.StorageBufferAttribute( new Float32Array( voxelcount * 3 ), 3 );
		const voxelInfoBuffer = new THREE.StorageBufferAttribute( new Uint32Array( voxelcount ), 1 );
		const positionBuffer = new THREE.StorageBufferAttribute( new Float32Array( mergedShipModel.positions ), 3 );
		const normalBuffer = new THREE.StorageBufferAttribute( new Float32Array( mergedShipModel.normals ), 3 );
		const indexBuffer = new THREE.StorageBufferAttribute( new Uint32Array( mergedShipModel.indices ), 1 );


		const voxelCompute = voxelShader( {
			voxelPositionBuffer: storage( voxelPositionBuffer, 'vec3', voxelPositionBuffer.count ),
			voxelInfoBuffer: storage( voxelInfoBuffer, 'u32', voxelInfoBuffer.count ),
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
		this.renderer.compute( voxelCompute, [ 8, 8, 8 ] );

		//------------------------------------------------------------------------------------------------------------

		//Now visualizing the voxels

		const voxel = new THREE.BoxGeometry( voxelSize, voxelSize, voxelSize );
		const instancedVoxelGeometry = new THREE.InstancedBufferGeometry();
		instancedVoxelGeometry.instanceCount = voxelcount;
		instancedVoxelGeometry.setIndex( new THREE.BufferAttribute( voxel.index.array, 1 ) );

		//instead of an attribute I use a buffer
		const voxelVerticePositionBuffer = new THREE.StorageBufferAttribute( voxel.attributes.position.array, 3 );


		const instancedVertexShader = wgslFn(`
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


		const instancedShaderParams = {
			projectionMatrix: cameraProjectionMatrix,
			cameraViewMatrix: cameraViewMatrix,
			modelWorldMatrix: modelWorldMatrix,
			instanceIndex: instanceIndex,
			vertexIndex: vertexIndex,

			positions: storage( voxelVerticePositionBuffer, 'vec3', voxelVerticePositionBuffer ).toReadOnly(),
			voxelPositionBuffer: storage( voxelPositionBuffer, 'vec3', voxelPositionBuffer.count ).toReadOnly(),
			voxelInfoBuffer: storage( voxelInfoBuffer, 'u32', voxelInfoBuffer.count ).toReadOnly(),
		}


		const voxelMaterial = new THREE.MeshBasicNodeMaterial();
		voxelMaterial.vertexNode = instancedVertexShader( instancedShaderParams );
		voxelMaterial.fragmentNode = vec4( 0, 1, 0, 1 );
		voxelMaterial.wireframe = true;

		const instancedVoxelMesh = new THREE.Mesh( instancedVoxelGeometry, voxelMaterial );

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
		scene.add( instancedVoxelMesh );
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
