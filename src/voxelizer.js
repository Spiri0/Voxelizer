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
import { StorageBufferAttribute } from "three/webgpu";
import { wgslFn, vec4, uniform, instanceIndex, vertexIndex, storage, struct, uint } from "three/tsl";
import { cameraProjectionMatrix, modelWorldMatrix, cameraViewMatrix } from "three/tsl";
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { voxelSurfaceShader } from '../shader/voxelSurfaceShader.js';
import { voxelVolumeShader } from '../shader/voxelVolumeShader.js';
import { voxelVertexShader } from '../shader/voxelVertexShader.js';
import { voxelFragmentShader } from '../shader/voxelFragmentShader.js';
import { initFlagBufferShader } from '../shader/initFlagBufferShader.js';



class Voxelizer {
	constructor() {
	}

	async init( params ) {

		this.params = params;

		const modelBoundingBox = new THREE.Box3().setFromObject( params.model );
		const mergedModel = this.extractMergedGeometry( params.model );
		const voxelSize = params.voxelSize;
		const gridSize = new THREE.Vector3();
		modelBoundingBox.getSize( gridSize );

		const nx = Math.ceil( gridSize.x / voxelSize );
		const ny = Math.ceil( gridSize.y / voxelSize );
		const nz = Math.ceil( gridSize.z / voxelSize );

		this.voxelcount = nx * ny * nz;

		this.workgroupSize = [ 8, 8, 4 ];

		const dispatchX = Math.ceil( nx / this.workgroupSize[ 0 ] );
		const dispatchY = Math.ceil( ny / this.workgroupSize[ 1 ] );
		const dispatchZ = Math.ceil( nz / this.workgroupSize[ 2 ] );

		this.dispatchSize = [ dispatchX, dispatchY, dispatchZ ];


		this.voxelPositionBuffer = new StorageBufferAttribute( new Float32Array( this.voxelcount * 3 ), 3 );
		this.voxelColorBuffer = new StorageBufferAttribute( new Float32Array( this.voxelcount * 4 ), 4 );
		this.voxelInfoBuffer = new StorageBufferAttribute( new Uint32Array( this.voxelcount ), 1 );
		const positionBuffer = new StorageBufferAttribute( new Float32Array( mergedModel.positions ), 3 );
		const normalBuffer = new StorageBufferAttribute( new Float32Array( mergedModel.normals ), 3 );
		const indexBuffer = new StorageBufferAttribute( new Uint32Array( mergedModel.indices ), 1 );
		this.changedFlagBuffer = new StorageBufferAttribute( new Uint32Array( 4 ), 4 );

		this.changedFlagBufferStruct = struct( {
			x: { type: 'u32' },
			y: { type: 'u32', atomic: true },
			z: { type: 'u32', atomic: true },
			w: { type: 'u32', atomic: true }
		}, 'FlagBuffer' );

		this.volumeVoxelComputeCount = 0;
		this.volumeVoxelChangeCount = 0;

		const voxelSurfaceCompute = voxelSurfaceShader( {
			voxelPositionBuffer: storage( this.voxelPositionBuffer, 'vec3', this.voxelPositionBuffer.count ),
			voxelInfoBuffer: storage( this.voxelInfoBuffer, 'u32', this.voxelInfoBuffer.count ),
			voxelColorBuffer: storage( this.voxelColorBuffer, 'vec4', this.voxelColorBuffer.count ),
			indexBuffer: storage( indexBuffer, 'u32', indexBuffer.count ),
			positions: storage( positionBuffer, 'vec3', positionBuffer.count ),
			normals: storage( normalBuffer, 'vec3', normalBuffer.count ),
			gridSize: uniform( new THREE.Vector3( nx, ny, nz) ),
			boundingBoxMin: uniform( modelBoundingBox.min ),
			boundingBoxMax: uniform( modelBoundingBox.max ),
			voxelSize: uniform( voxelSize ),
			positionsLength: uniform( uint( positionBuffer.count ) ),
			indicesLength: uniform( uint( indexBuffer.count ) ),
			index: instanceIndex,
		} ).computeKernel( this.workgroupSize );
		params.renderer.compute( voxelSurfaceCompute, [ dispatchX, dispatchY, dispatchZ ] );
		//params.renderer.compute( voxelSurfaceCompute, [ 200, 200, 1 ] );


		this.initFlagBuffer = initFlagBufferShader( {
			changedFlagBuffer: storage( this.changedFlagBuffer, this.changedFlagBufferStruct, this.changedFlagBuffer.count ),
		} ).compute( 1 );		


		this.voxelVolumeCompute = voxelVolumeShader( {
			voxelPositionBuffer: storage( this.voxelPositionBuffer, 'vec3', this.voxelPositionBuffer.count ),
			voxelInfoBuffer: storage( this.voxelInfoBuffer, 'u32', this.voxelInfoBuffer.count ),
			changedFlagBuffer: storage( this.changedFlagBuffer, this.changedFlagBufferStruct, this.changedFlagBuffer.count ),
			voxelColorBuffer: storage( this.voxelColorBuffer, 'vec4', this.voxelColorBuffer.count ),
			gridSize: uniform( new THREE.Vector3( nx, ny, nz) ),
			index: instanceIndex,
		} ).computeKernel( [ 8, 8, 4 ] );

		
		await this.floodFillVolumeShader();

		//------------------------------------------------------------------------------------------------------------


		const voxel = new THREE.BoxGeometry( voxelSize, voxelSize, voxelSize );
		const voxelVerticePositionBuffer = new StorageBufferAttribute( voxel.attributes.position.array, 3 );


		const voxelVertexShaderParams = {
			projectionMatrix: cameraProjectionMatrix,
			cameraViewMatrix: cameraViewMatrix,
			modelWorldMatrix: modelWorldMatrix,
			instanceIndex: instanceIndex,
			vertexIndex: vertexIndex,
			positions: storage( voxelVerticePositionBuffer, 'vec3', voxelVerticePositionBuffer ).toReadOnly(),
			voxelPositionBuffer: storage( this.voxelPositionBuffer, 'vec3', this.voxelPositionBuffer.count ).toReadOnly(),
			voxelInfoBuffer: storage( this.voxelInfoBuffer, 'u32', this.voxelInfoBuffer.count ).toReadOnly()
		}


		const voxelFragmentShaderParams = {
			instanceIndex: instanceIndex,
			voxelColorBuffer: storage( this.voxelColorBuffer, 'vec4', this.voxelColorBuffer.count ).toReadOnly()
		}


		//Now visualizing the voxels
		const voxelGeometry = new THREE.InstancedBufferGeometry();
		voxelGeometry.instanceCount = this.voxelcount;
		voxelGeometry.setIndex( new THREE.BufferAttribute( voxel.index.array, 1 ) );

		const voxelMaterial = new THREE.MeshBasicNodeMaterial();
		voxelMaterial.vertexNode = voxelVertexShader( voxelVertexShaderParams );
		voxelMaterial.fragmentNode = voxelFragmentShader( voxelFragmentShaderParams );
		voxelMaterial.wireframe = true;

		this.voxelMesh = new THREE.Mesh( voxelGeometry, voxelMaterial );
		this.voxelMesh.frustumCulled = false;

		//-------------------------------------------------------------------------------------------

		//Visualize the merged model geometry

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
		for( let i = 0; i < mergedModel.positions.length; i ++ ){
			indices.push(i);
		}

		const mergedGeometry = new THREE.BufferGeometry();
		mergedGeometry.setIndex( new THREE.BufferAttribute( new Uint32Array( indices ), 1 ) );

		const modelMaterial = new THREE.MeshBasicNodeMaterial();
		modelMaterial.vertexNode = mergedModelVertexShader( modelShaderParams );
		modelMaterial.fragmentNode = vec4( 0, 0, 1, 1 );
		modelMaterial.side = THREE.DoubleSide;

		this.mergedMesh = new THREE.Mesh( mergedGeometry, modelMaterial );

	}


	async floodFillVolumeShader() {

		await this.params.renderer.computeAsync( this.initFlagBuffer );
		await this.params.renderer.computeAsync( this.voxelVolumeCompute, this.dispatchSize );

		const isChanged = new Uint32Array( await this.params.renderer.getArrayBufferAsync( this.changedFlagBuffer ) );

		this.volumeVoxelComputeCount += 1;

		if ( isChanged[0] === 1 && this.volumeVoxelChangeCount !== isChanged[1] ) {

			this.volumeVoxelChangeCount = isChanged[1];

			await this.floodFillVolumeShader();

		} else {

			console.log( "Volume voxeling iteration steps: " + this.volumeVoxelComputeCount );

		}

	};


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

}


export default Voxelizer;