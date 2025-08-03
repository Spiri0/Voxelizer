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
import Voxelizer from './voxelizer.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';



class Main {
	constructor() {
	}

	async init( canvas ) {

		this.renderer = new THREE.WebGPURenderer( { 
			canvas: canvas,
			antialias: true,
			forceWebGL: false
		} );

		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.renderer.setPixelRatio(window.devicePixelRatio);
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		this.renderer.physicallyCorrectLights = true;
		this.renderer.setClearColor( 0x000000 );
		this.renderer.domElement.id = 'threejs';

		this.container = document.getElementById('container');
		this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
		this.container.appendChild( this.renderer.domElement );

		await this.renderer.init();

		const aspect = this.container.clientWidth / this.container.clientHeight; 
		const fov = 50;
		const near = 0.1;
		const far = 1E6;
		this.camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
		this.scene = new THREE.Scene();
		this.scene.background = new THREE.Color( 0x00001f );

		this.camera.position.set( -300, 120, -200 );
		this.controls = new OrbitControls( this.camera, this.renderer.domElement );
		this.controls.target.set( 0, 0, 0 );
		this.controls.update();

		//-------------------------------------------------------------------------------------------

		const sabo = await this.modelLoader( './resources/models/CVE.glb' );
		//const sabo = await this.modelLoader( './resources/models/blackPearl.glb' );
		
		this.voxelizer = new Voxelizer();
		await this.voxelizer.init( {
			renderer: this.renderer,
			model: sabo,
			voxelSize: 0.5 / 0.3048	//sabo model is in feet 0.5 means 0.5m
			//voxelSize: 0.2	//for black pearl
		} );

		
		this.scene.add( sabo );
		this.scene.add( this.voxelizer.voxelMesh );
		this.scene.add( this.voxelizer.mergedMesh );

		sabo.visible = false;

		const gui = new GUI();


		const visibility = {
			ship: false,
			voxelMesh: true,
			mergedMesh: true
		};

		gui.add( visibility, 'ship' ).onChange( ( value ) => {
			sabo.visible = value;
		});

		gui.add( visibility, 'voxelMesh' ).onChange( ( value ) => {
			this.voxelizer.voxelMesh.visible = value;
		});

		gui.add( visibility, 'mergedMesh' ).onChange( ( value ) => {
			this.voxelizer.mergedMesh.visible = value;
		});

		//-------------------------------------------------------------------------------------------

		const ambientLight = new THREE.AmbientLight( 0xffffff, 0.6 );
		this.scene.add( ambientLight );

		window.addEventListener('resize', () => {
			this.OnResize();	
		}, false );

		this.render();

	}


	async modelLoader( url ) {
		const loader = new GLTFLoader();
		try {
			const gltf = await loader.loadAsync( url );
			return gltf.scene;
		} catch ( error ) {
			throw error;
		}
	}


	render() {

		this.renderer.render( this.scene, this.camera );

		requestAnimationFrame( async () => {
			this.render();
		} );

	}


	OnResize() {
		
		const width = this.container.clientWidth;
		const height = this.container.clientHeight;
		
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(width, height);	
	}

}


export default Main;
