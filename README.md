See it running live [here](https://spiri0.github.io/Threejs-WebGPU-Voxelizer/index.html)

The ship model is the Sabo, a Casablanca-class escort carrier from Phil Crowther's aviation repository.
https://github.com/PhilCrowther/Aviation

Surface voxels are green. Volume voxels are yellow.

![image](https://github.com/user-attachments/assets/2ca0c4ee-70d7-496b-808d-7458bc0a84ee)

This voxelizer allows you to very precisely determine the volume of any shaped closed body. This is important for precise buoyancy calculations. It is also suitable for more accurate collision detection.
Since voxelization is performed on the GPU, very complex meshes can be voxelized extremely quickly.
