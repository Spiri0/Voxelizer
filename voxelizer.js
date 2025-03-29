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
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { wgslFn, vec4, uniform, instanceIndex, vertexIndex, storage, uint } from "three/tsl";
import { cameraProjectionMatrix, modelWorldMatrix, cameraViewMatrix } from "three/tsl";
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { voxelSurfaceShader } from './shader/voxelSurfaceShader.js';
import { voxelVolumeShader } from './shader/voxelVolumeShader.js';
import { voxelVertexShader } from './shader/voxelVertexShader.js';
import { voxelFragmentShader } from './shader/voxelFragmentShader.js';
import { initFlagBufferShader } from './shader/initFlagBufferShader.js';
import {GUI} from 'three/addons/libs/lil-gui.module.min.js';



class Voxelizer {
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
		this.camera.position.set( -300, 120, -200 );
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


		const voxelPositionBuffer = new THREE.StorageBufferAttribute( new Float32Array( voxelcount * 3 ), 3 );
		const voxelColorBuffer = new THREE.StorageBufferAttribute( new Float32Array( voxelcount * 4 ), 4 );
		const voxelInfoBuffer = new THREE.StorageBufferAttribute( new Uint32Array( voxelcount ), 1 );
		const positionBuffer = new THREE.StorageBufferAttribute( new Float32Array( mergedShipModel.positions ), 3 );
		const normalBuffer = new THREE.StorageBufferAttribute( new Float32Array( mergedShipModel.normals ), 3 );
		const indexBuffer = new THREE.StorageBufferAttribute( new Uint32Array( mergedShipModel.indices ), 1 );
		this.changedFlagBuffer = new THREE.StorageBufferAttribute( new Uint32Array( 1 ), 1 );


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


		this.initFlagBuffer = initFlagBufferShader( {
			changedFlagBuffer: storage( this.changedFlagBuffer, 'u32', this.changedFlagBuffer.count ),
		} ).compute( 1 );		


		this.voxelVolumeCompute = voxelVolumeShader( {
			voxelPositionBuffer: storage( voxelPositionBuffer, 'vec3', voxelPositionBuffer.count ),
			voxelInfoBuffer: storage( voxelInfoBuffer, 'u32', voxelInfoBuffer.count ),
			changedFlagBuffer: storage( this.changedFlagBuffer, 'u32', this.changedFlagBuffer.count ),
			voxelColorBuffer: storage( voxelColorBuffer, 'vec4', voxelColorBuffer.count ),
			gridSize: uniform( new THREE.Vector3( nx, ny, nz) ),
			index: instanceIndex,
		} ).compute( voxelcount );


		await this.floodFillVolumeShader();
		
		//------------------------------------------------------------------------------------------------------------

		//visualizing the voxels
		const voxel = new THREE.BoxGeometry( voxelSize, voxelSize, voxelSize );
		const voxelGeometry = new THREE.InstancedBufferGeometry();
		voxelGeometry.instanceCount = voxelcount;
		voxelGeometry.setIndex( new THREE.BufferAttribute( voxel.index.array, 1 ) );

		//instead of an attribute I use a buffer
		const voxelVerticePositionBuffer = new THREE.StorageBufferAttribute( voxel.attributes.position.array, 3 );


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
		voxelMesh.frustumCulled = false;

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
		mergedMesh.frustumCulled = false;

		//-------------------------------------------------------------------------------------------

		scene.add( ship );
		scene.add( voxelMesh );
		scene.add( mergedMesh );

		ship.visible = false;

		const gui = new GUI();


		const visibility = {
			ship: false,
			voxelMesh: true,
			mergedMesh: true
		};

		gui.add(visibility, 'ship').onChange((value) => {
			ship.visible = value;
		});

		gui.add(visibility, 'voxelMesh').onChange((value) => {
			voxelMesh.visible = value;
		});

		gui.add(visibility, 'mergedMesh').onChange((value) => {
			mergedMesh.visible = value;
		});

		//-------------------------------------------------------------------------------------------

		const ambientLight = new THREE.AmbientLight( 0xffffff, 0.6 );
		scene.add( ambientLight );

		window.addEventListener( "resize", this.onWindowResize, false );

		this.render();

	}


	async floodFillVolumeShader() {

		await this.renderer.computeAsync( this.initFlagBuffer );
		await this.renderer.computeAsync( this.voxelVolumeCompute, [ 8, 8, 8 ] );

		const isChanged = new Uint32Array( await this.renderer.getArrayBufferAsync( this.changedFlagBuffer ) );

		if ( isChanged[0] === 1 ) {
		
			await this.floodFillVolumeShader();
		} else {
			console.log("Volume iteration finished");
		}

	};


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

				geometry.applyMatrix4( object.matrixWorld );

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

		requestAnimationFrame( async () => {
			this.render();
		} );

	}


	onWindowResize() {
		this.camera.aspect = window.innerWidth / window.innerHeight;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize( window.innerWidth, window.innerHeight );
	}

}


export { Voxelizer }
