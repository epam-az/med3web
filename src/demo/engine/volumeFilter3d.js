/* eslint-disable no-magic-numbers */
/*
Licensed to the Apache Software Foundation (ASF) under one
or more contributor license agreements.  See the NOTICE file
distributed with this work for additional information
regarding copyright ownership.  The ASF licenses this file
to you under the Apache License, Version 2.0 (the
"License"); you may not use this file except in compliance
with the License.  You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing,
software distributed under the License is distributed on an
"AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, either express or implied.  See the License for the
specific language governing permissions and limitations
under the License.
*/

/**
 * 3D volume processing engine: blur, contrast filter
 * @module lib/scripts/graphics3d/volumeFilter3d
 */

import * as THREE from 'three';
import MaterialBlur from './gfx/matblur';
import GlSelector from './GlSelector';
import AmbientTexture from './ambientTexture';
import TransferTexture from './transferTexture'

const tools3dEraser = {
  TAN: 'tan',
  NORM: 'norm',
  FILL: 'fill'
};

/** Class Graphics3d is used for 3d render */
export default class VolumeFilter3d {
  constructor() {
    this.transferFunc = null;
    this.lastSize = [];
    this.lastDepth = [];
    this.lastRotationVector = [];
    this.lastTarget = [];
    this.lastMode = [];
    this.lastBackDistance = [];
    this.resetflag = false;
    this.xDim = 0;
    this.yDim = 0;
    this.zDim = 0;
    this.zDimSqrt = 0;
    this.initMatBlure = 0;
  }
  /**
   * Filtering the source data and building the normals on the GPU
   * @param isRoiVolume
   * @param roiColors Array of roi colors in RGBA format
   */
  initRenderer(isRoiVolume, roiColors) {
    this.sceneBlur = new THREE.Scene();
    const blurSigma = 0.8;
    this.numRois = 256;
    // eslint-disable-next-line
    this.cameraOrtho = new THREE.OrthographicCamera(this.xDim / -2, this.xDim / 2, this.yDim / 2, this.yDim / -2, 0.1, 100);
    const glSelector = new GlSelector();
    this.context = glSelector.createWebGLContext();
    this.canvas3d = glSelector.getCanvas();
    this.rendererBlur = new THREE.WebGLRenderer({
      canvas: this.canvas3d,
      context: this.context
    });
    this.ambientTexture = new AmbientTexture({
      xDim: this.xDim,
      yDim: this.yDim,
      zDim: this.zDim,
      renderer: this.rendererBlur,
      scene: this.sceneBlur,
      camera: this.cameraOrtho,
    });

    console.log('rendererBlur done');
    const geometryBlur = new THREE.PlaneGeometry(1.0, 1.0);
    this.rendererBlur.setSize(this.xDim, this.yDim);
    //
    this.transferFunc = new TransferTexture();
    this.transferFunc.init(isRoiVolume, roiColors);
    const texelSize = new THREE.Vector3(1.0 / this.xDim, 1.0 / this.yDim, 1.0 / this.zDim);
    const matBlur = new MaterialBlur();

    matBlur.create(this.origVolumeTex, this.RoiVolumeTex, texelSize, this.transferFunc.texRoiColor, this.transferFunc.texRoiId, (mat) => {
      const mesh = new THREE.Mesh(geometryBlur, mat);
      mat.uniforms.tileCountX.value = this.zDimSqrt;
      mat.uniforms.volumeSizeZ.value = this.zDim;
      mat.uniforms.xDim.value = this.xDim;
      mat.uniforms.yDim.value = this.yDim;
      mat.defines.useWebGL2 = this.isWebGL2;
      this.material = mat;
      this.sceneBlur.add(mesh);
      if (isRoiVolume === false) {
        this.switchToBlurRender();
      } else {
        this.switchToRoiMapRender();
        //this.setVolumeTexture(blurSigma);
      }
      // render with blur and copy pixels back to this.bufferRgba
      console.log(`isRoiVolume: ${isRoiVolume}`);
      this.setVolumeTexture(blurSigma);
    });
    this.vectorsTex = null;
    //this.setAmbientTexture();
  }
  /**
   * Create 2D texture containing transfer func colors
  */
  createTransferFuncTexture() {
    return this.transferFunc.createTransferFuncTexture();
  }
  /**
   * Creates transfer function color map
   * @param ctrlPts Array of control points of type HEX  = color value
   */
  setTransferFuncColors(ctrlPtsColorsHex) {
    this.transferFunc.setTransferFuncColors(ctrlPtsColorsHex);
  }
  /**
   * Creates transfer function color map
   * @param ctrlPts Array of Vector2 where (x,y) = x coordinate in [0, 1], alpha value in [0, 1]
   * //intensity [0,255] opacity [0,1]
   */
  updateTransferFuncTexture(intensities, opacities) {
    return this.transferFunc.updateTransferFuncTexture(intensities, opacities);
  }
  /**
   * Setting a variable for conditional compilation (Roi Render)
   */
  switchToRoiMapRender() {
    this.material.defines.renderRoiMap = 1;
    this.material.needsUpdate = true;
  }
  /**
   * Setting a variable for conditional compilation (Blur)
   */
  switchToBlurRender() {
    this.material.defines.renderRoiMap = 0;
    this.material.needsUpdate = true;
  }
  /**
   * Filtering the source data and building the normals on the GPU
   * @param blurSigma Gauss sigma parameter
   */
  setVolumeTexture(blurSigma) {
    if ((!this.material) || (typeof this.material === 'undefined')) {
      console.log('blur material null');
      return;
    }
    console.log('blur material NOT null');
    if (this.isWebGL2 === 0) {
      // this.setVolumeTextureWebGL1(blurSigma);
    } else {
      this.setVolumeTextureWebGL2(blurSigma);
    }
    this.updatableTexture.needsUpdate = true;
  }
  setVolumeTextureWebGL2(blurSigma) {
    this.material.uniforms.blurSigma.value = blurSigma;
    this.material.uniforms.blurSigma.needsUpdate = true;
    const VAL_1 = 1;
    const VAL_2 = 2;
    const VAL_3 = 3;
    const VAL_4 = 4;
    const frameBuf = new Uint8Array(VAL_4 * this.xDim * this.yDim);
    const gl = this.rendererBlur.getContext();
    console.log('Blur WebGL2');
    for (let z = 1; z < this.zDim - 1; ++z) {
      this.material.uniforms.curZ.value = z / this.zDim;
      this.material.uniforms.curZ.needsUpdate = true;

      this.rendererBlur.render(this.sceneBlur, this.cameraOrtho, this.bufferTexture);
      gl.readPixels(0, 0, this.xDim, this.yDim, gl.RGBA, gl.UNSIGNED_BYTE, frameBuf);
      const zOffs = z * this.xDim * this.yDim;
      for (let y = 0; y < this.yDim; y++) {
        for (let x = 0; x < this.xDim; x++) {
          if (this.isRoiVolume) {
            const indxR = VAL_4 * (x + y * this.xDim);
            const indxL = indxR + zOffs * VAL_4;
            this.bufferTextureCPU[indxL] = frameBuf[indxR];
            this.bufferTextureCPU[indxL + VAL_1] = frameBuf[indxR + VAL_1];
            this.bufferTextureCPU[indxL + VAL_2] = frameBuf[indxR + VAL_2];
            this.bufferTextureCPU[indxL + VAL_3] = frameBuf[indxR + VAL_3];
          } else {
            this.bufferTextureCPU[x + y * this.xDim + zOffs] =
              frameBuf[VAL_4 * (x + y * this.xDim)]; //256.0 * k / this.zDim;
          }
        }
      }
    }
  }
  /**
   * Copies the source data into the buffer (bufferRgba) from which the 3� texture is created
   */
  setBufferRgbaFrom1Byte() {
    const OFF0 = 0;
    this.bufferTextureCPU = new Uint8Array(this.numPixelsBuffer);
    this.bufferR = new Uint8Array(this.numPixelsBuffer);
    // Fill initial rgba array
    for (let yTile = 0; yTile < this.zDimSqrt; yTile++) {
      const yTileOff = (yTile * this.yDim) * this.xTex;
      for (let xTile = 0; xTile < this.zDimSqrt; xTile++) {
        const xTileOff = xTile * this.xDim;
        const zVol = xTile + (yTile * this.zDimSqrt);
        if (zVol >= this.zDim) {
          break;
        }
        const zVolOff = zVol * this.xDim * this.yDim;
        for (let y = 0; y < this.yDim; y++) {
          const yVol = y;
          const yVolOff = yVol * this.xDim;
          for (let x = 0; x < this.xDim; x++) {
            const xVol = x;

            const offSrc = (xVol + yVolOff + zVolOff);
            const valInt = this.arrPixels[offSrc + 0];
            const offDst = yTileOff + xTileOff + (y * this.xTex) + x;
            this.bufferR[offDst + OFF0] = valInt;
            this.bufferTextureCPU[offDst + OFF0] = valInt;
          }
        }
      }
    }
    console.log('setBufferRgbaFrom1Bytes');

  }
  /**
   * Copies the source data into the buffer (bufferRgba) from which the 3� texture is created
   */
  set3DTextureFrom1Byte() {
    const OFF0 = 0;
    this.bufferTextureCPU = new Uint8Array(this.xDim * this.yDim * this.zDim);
    this.bufferR = new Uint8Array(this.xDim * this.yDim * this.zDim);
    // Fill initial rgba array
    for (let z = 0; z < this.zDim; z++) {
      const zVolOff = z * this.xDim * this.yDim;
      for (let y = 0; y < this.yDim; y++) {
        const yVol = y;
        const yVolOff = yVol * this.xDim;
        for (let x = 0; x < this.xDim; x++) {
          const xVol = x;
          const offSrc = (xVol + yVolOff + zVolOff);
          let valInt = this.arrPixels[offSrc + 0];
          const offDst = offSrc;
          if (this.zDim > 5 && (z === 0 || z === this.zDim - 1)) {
            valInt = 0;
          }
          this.bufferR[offDst + OFF0] = valInt;
          this.bufferTextureCPU[offDst + OFF0] = valInt;
        }
      }
    }
    console.log('setBufferRgbaFrom1Bytes for 3d texture');
  }
  /**
   * Copies the source data into the buffer (bufferRgba) from which the 3� texture is created
   */
  setBufferRgbaFrom4Bytes() {
    const OFF0 = 0;
    const OFF1 = 1;
    const OFF2 = 2;
    const OFF3 = 3;
    const BID = 4;
    if (this.isRoiVolume) {
      this.bufferRoi = new Uint8Array(this.numPixelsBuffer);
      const c4 = 4;
      this.bufferTextureCPU = new Uint8Array(c4 * this.numPixelsBuffer);
      console.log('ROI');
    }
    this.bufferR = new Uint8Array(this.numPixelsBuffer);

    // Fill initial rgba array
    for (let yTile = 0; yTile < this.zDimSqrt; yTile++) {
      const yTileOff = (yTile * this.yDim) * this.xTex;
      for (let xTile = 0; xTile < this.zDimSqrt; xTile++) {
        const xTileOff = xTile * this.xDim;
        const zVol = xTile + (yTile * this.zDimSqrt);
        if (zVol >= this.zDim) {
          break;
        }
        const zVolOff = zVol * this.xDim * this.yDim;
        for (let y = 0; y < this.yDim; y++) {
          const yVol = y;
          const yVolOff = yVol * this.xDim;
          for (let x = 0; x < this.xDim; x++) {
            const xVol = x;

            const offSrc = (xVol + yVolOff + zVolOff) * BID;
            const valInt = this.arrPixels[offSrc + 0];
            const valRoi = this.arrPixels[offSrc + OFF3];
            const offDst = yTileOff + xTileOff + (y * this.xTex) + x;
            this.bufferR[offDst + OFF0] = valRoi;
            this.bufferTextureCPU[BID * offDst + OFF0] = valInt;
            this.bufferTextureCPU[BID * offDst + OFF1] = valInt;
            this.bufferTextureCPU[BID * offDst + OFF2] = valInt;
            // this.bufferTextureCPU[BID * offDst + OFF3] =
            // 255.0 * zVol * (x + y) / ( this.zDimSqrt * this.zDimSqrt * (this.xDim + this.yDim));
            this.bufferTextureCPU[BID * offDst + OFF3] = valInt;
            this.bufferRoi[offDst + OFF0] = valRoi;

          }
        }
      }
    }
    console.log('setBufferRgbaFrom4Bytes');
  }
  /**
   * Copies the source data into the buffer (bufferRgba) from which the 3� texture is created
   */
  set3DTextureFrom4Bytes() {
    const OFF0 = 0;
    const OFF1 = 1;
    const OFF2 = 2;
    const OFF3 = 3;
    const BID = 4;
    if (this.isRoiVolume) {
      this.bufferRoi = new Uint8Array(this.xDim * this.yDim * this.zDim);
      this.bufferTextureCPU = new Uint8Array(BID * this.xDim * this.yDim * this.zDim);
      console.log('ROI');
    }
    this.bufferR = new Uint8Array(this.xDim * this.yDim * this.zDim);
    // Fill initial rgba array
    for (let z = 0; z < this.zDim; z++) {
      const zVolOff = z * this.xDim * this.yDim;
      for (let y = 0; y < this.yDim; y++) {
        const yVol = y;
        const yVolOff = yVol * this.xDim;
        for (let x = 0; x < this.xDim; x++) {
          const xVol = x;

          const offSrc = (xVol + yVolOff + zVolOff) * BID;
          const valInt = this.arrPixels[offSrc + 0];
          const valRoi = this.arrPixels[offSrc + OFF3];
          const offDst = xVol + yVolOff + zVolOff;
          this.bufferR[offDst + OFF0] = valRoi;
          this.bufferTextureCPU[BID * offDst + OFF0] = valInt;
          this.bufferTextureCPU[BID * offDst + OFF1] = valInt;
          this.bufferTextureCPU[BID * offDst + OFF2] = valInt;
          this.bufferTextureCPU[BID * offDst + OFF3] = valInt;
          this.bufferRoi[offDst + OFF0] = valRoi;
        }
      }
    }
    console.log('setBufferRgbaFrom4Bytes for 3D texture');
  }
  getOffDstValueByXYZ(mainX, mainY, mainZ) {
    if (this.isWebGL2 === 0) {
      const yTile = Math.floor(mainZ / this.zDimSqrt);
      const xTile = mainZ - this.zDimSqrt * yTile;
      const yTileOff = (yTile * this.yDim) * this.xTex;
      const xTileOff = xTile * this.xDim;
      return yTileOff + (mainY * this.xTex) + xTileOff + mainX;
    } else {
      return mainX + mainY * this.xTex + mainZ * this.xTex * this.yTex;
    }
  }
  erasePixels(x_, y_, z_, size, depth, vDir, isothreshold, startflag, mouseup, normalmode, length) {
    if (mouseup === true) {
      this.resetflag = false;
      this.prevDistance = null;
      return;
    }
    const targetX = Math.floor(x_ * this.xDim);
    const targetY = Math.floor(y_ * this.yDim);
    const targetZ = Math.floor(z_ * this.zDim);

    //console.log(`${Math.abs(this.prevPos - targetX - targetY - targetZ)}`);
    //if ( Math.abs(this.prevPos - (targetX + targetY + targetZ)) <= radius) {
    console.log(`Target erasePixels: ${targetX}, ${targetY}, ${targetZ}`);
    const normal = new THREE.Vector3();
    const normalGauss = new THREE.Vector3();
    const GAUSS_R = 2;
    const SIGMA = 1.4;
    const SIGMA2 = SIGMA * SIGMA;
    let nX = 0;
    let nY = 0;
    let nZ = 0;
    let normFactor = 0;
    let offDst = 0;
    const VAL_2 = 2; // getting normal of surface
    for (let k = -Math.min(GAUSS_R, targetZ); k <= Math.min(GAUSS_R, this.zDim - 1 - targetZ); k++) {
      for (let j = -Math.min(GAUSS_R, targetY); j <= Math.min(GAUSS_R, this.yDim - 1 - targetY); j++) {
        for (let i = -Math.min(GAUSS_R, targetX); i <= Math.min(GAUSS_R, this.xDim - 1 - targetX); i++) {
          // handling voxel:
          // (targetX + i; ,targetY+ j; targetZ + k);
          const gX = targetX + i;
          const gY = targetY + j;
          const gZ = targetZ + k;
          if (this.isWebGL2 === 0) {
            const yTile = Math.floor(gZ / this.zDimSqrt);
            const xTile = gZ - this.zDimSqrt * yTile;
            const yTileOff = (yTile * this.yDim) * this.xTex;
            const xTileOff = xTile * this.xDim;
            offDst = yTileOff + (gY * this.xTex) + xTileOff + gX;
          } else {
            offDst = gX + gY * this.xDim + gZ * this.xDim * this.yDim;
          }
          const gauss = 1 - Math.exp(-(i * i + j * j + k * k) / (VAL_2 * SIGMA2));
          normFactor += gauss;

          const curVal = this.bufferTextureCPU[offDst];
          nX += curVal * gauss * (-i / SIGMA2);
          nY += curVal * gauss * (-j / SIGMA2);
          nZ += curVal * gauss * (-k / SIGMA2);

        }
      }
    }// end gauss summation
    normalGauss.set(nX / normFactor, nY / normFactor, nZ / normFactor);
    normal.copy(normalGauss);
    if (normalmode === false) { //if tangetial mode - getting direction of view as normal of cylinder
      normal.copy(vDir);
      normal.multiplyScalar(-1.0);
      this.lastMode.push(tools3dEraser.TAN);
    } else {
      this.lastMode.push(tools3dEraser.NORM);
    }
    normal.normalize();
    console.log(`Normal: X: ${normal.x} Y: ${normal.y} Z: ${normal.z}`);

    //const pidivide2 = 90; //pi/2 (just for console output)
    const pi = 180;// pi (just for console output)
    //const radius = 20; //distance between current position and prevPos in which we are allowed to delete

    // Erase data in original texture

    /*console.log(`${Math.abs(new THREE.Vector3(targetX, targetY, targetZ).normalize().x)}
    ${Math.abs(new THREE.Vector3(targetX, targetY, targetZ).normalize().y)}
    ${Math.abs(new THREE.Vector3(targetX, targetY, targetZ).normalize().z)}
    ${Math.abs(pidivide2 - vDir.normalize().angleTo(normalGauss.normalize()) * pi / Math.PI)}`);*/
    const radiusRatio = this.xDim / this.zDim;
    const geometry = new THREE.CylinderGeometry(size, size, depth, pi, depth);
    const mesh = new THREE.Mesh(geometry, null);
    const axis = new THREE.Vector3(0, 0, 1);
    mesh.quaternion.setFromUnitVectors(axis, normal.clone().normalize().multiplyScalar(-1));
    mesh.position.copy(new THREE.Vector3(targetX, targetY, targetZ));

    if (startflag === true) {
      this.prevDistance = length;
      this.resetflag = false;
    }
    this.radius = 0.05;
    //console.log(`${Math.abs(this.prevDistance - length) * 1000}`);
    //console.log(`${this.radius * 1000}`);
    if (this.resetflag === false) {
      if (Math.abs(this.prevDistance - length) < this.radius) {
        this.prevDistance = length;
        this.point = new THREE.Vector3(0, 0, 0);
        this.queue = [];
        this.queue.push(this.point);
        const normalBack = -5;
        let backZ = 0;
        if (normalmode === false) { //some manipulatian with cylinder for tangential mode
          backZ = 0 - Math.round(Math.abs(Math.tan(vDir.normalize().angleTo(normalGauss.normalize()))) * (size));
        } else {
          backZ = normalBack;
        }
        let deleteflag = false;
        while (this.queue.length > 0) {
          this.point = this.queue.pop();
          const RotPoint = this.point.clone();
          RotPoint.z *= radiusRatio;
          RotPoint.applyAxisAngle(new THREE.Vector3(1, 0, 0), -mesh.rotation.x);
          RotPoint.applyAxisAngle(new THREE.Vector3(0, 1, 0), -mesh.rotation.y);
          RotPoint.applyAxisAngle(new THREE.Vector3(0, 0, 1), mesh.rotation.z);
          if (Math.sqrt(RotPoint.x * RotPoint.x + RotPoint.y * RotPoint.y) > size ||
            Math.abs(RotPoint.z) > depth || RotPoint.z < backZ) {
            continue;
          }
          for (let x = this.point.x - 1; x <= this.point.x + 1; x++) {
            for (let y = this.point.y - 1; y <= this.point.y + 1; y++) {
              for (let z = this.point.z - 1; z <= this.point.z + 1; z++) {
                const mainX = targetX + Math.round(x);
                const mainY = targetY + Math.round(y);
                const mainZ = targetZ + Math.round(z);
                if (this.isWebGL2 === 0) {
                  const yTile = Math.floor(mainZ / this.zDimSqrt);
                  const xTile = mainZ - this.zDimSqrt * yTile;
                  const yTileOff = (yTile * this.yDim) * this.xTex;
                  const xTileOff = xTile * this.xDim;
                  offDst = yTileOff + (mainY * this.xTex) + xTileOff + mainX;
                } else {
                  offDst = mainX + mainY * this.xDim + mainZ * this.xDim * this.yDim;
                }
                if (this.bufferMask[offDst] === 0) {
                  continue;
                }

                const bitconst = 255.0;
                const borderinclude = 0.01;
                const isoSurfaceBorder = isothreshold * bitconst - borderinclude * bitconst;

                if (this.bufferTextureCPU[offDst] >= isoSurfaceBorder) {
                  deleteflag = true;
                  this.bufferMask[offDst] = 0;
                  this.queue.push(new THREE.Vector3(x, y, z));
                }
              }
            }
          }
        }
        if (deleteflag === true) {
          this.lastSize.push(size);
          this.lastDepth.push(depth);
          this.lastRotationVector.push(new THREE.Vector3(-mesh.rotation.x, -mesh.rotation.y, mesh.rotation.z));
          this.lastTarget.push(new THREE.Vector3(targetX, targetY, targetZ));
          this.lastBackDistance.push(-Math.round(Math.abs(Math.tan(vDir.normalize().angleTo(normalGauss.normalize())))
            * (size)));
        }
        this.updatableTextureMask.needsUpdate = true;
      } else {
        this.resetflag = true;
      }
    }
  }
  getIntensity(pointX, pointY, pointZ, undoFlag) {
    const full = 255;
    let offDst = 0;
    if (this.isWebGL2 === 0) {
      const yTile = Math.floor(pointZ / this.zDimSqrt);
      const xTile = pointZ - this.zDimSqrt * yTile;
      const yTileOff = (yTile * this.yDim) * this.xTex;
      const xTileOff = xTile * this.xDim;
      offDst = yTileOff + (pointY * this.xTex) + xTileOff + pointX;
    } else {
      offDst = pointX + pointY * this.xDim + pointZ * this.xDim * this.yDim;
    }
    let intensityPoint = this.bufferTextureCPU[offDst];
    if ((this.bufferMask[offDst] === 0) && (!undoFlag)) {
      intensityPoint = 0;
    } else if ((this.bufferMask[offDst] === full) && (undoFlag)) {
      intensityPoint = 0;
    }
    return intensityPoint;
  }
  changeIntensity(targetX, targetY, targetZ, undoFlag) {
    const mainX = targetX;
    const mainY = targetY;
    const mainZ = targetZ;
    let offDst = 0;
    if (this.isWebGL2 === 0) {
      const yTile = Math.floor(mainZ / this.zDimSqrt);
      const xTile = mainZ - this.zDimSqrt * yTile;
      const yTileOff = (yTile * this.yDim) * this.xTex;
      const xTileOff = xTile * this.xDim;
      offDst = yTileOff + (mainY * this.xTex) + xTileOff + mainX;
    } else {
      offDst = mainX + mainY * this.xDim + mainZ * this.xDim * this.xDim;
    }
    if (undoFlag) {
      this.bufferMask[offDst] = 255;
    } else {
      this.bufferMask[offDst] = 0;
    }
  }
  erasePixelsFloodFill(x_, y_, z_, startflag, mouseup, undoFlag) {
    let targetX;
    let targetY;
    let targetZ;
    if (!undoFlag) {
      targetX = Math.floor(x_ * this.xDim);
      targetY = Math.floor(y_ * this.yDim);
      targetZ = Math.floor(z_ * this.zDim);
      if (startflag === true) { // if we started drawing there are no previous position
        this.prevPos = null;
      }
      if (mouseup === true) { //getting previous position as our mouse is not pressed
        this.prevPos = targetX + targetY + targetZ;
        return;
      }
      if (this.prevPos === null) {
        this.prevPos = targetX + targetY + targetZ;
      }
      console.log(`Target: ${targetX}, ${targetY}, ${targetZ}`);
      this.lastMode.push(tools3dEraser.FILL);
    } else {
      targetX = x_;
      targetY = y_;
      targetZ = z_;
    }
    const intensityTarget = this.getIntensity(targetX, targetY, targetZ, undoFlag);
    const stack = [];
    stack.push({ 'tX':targetX, 'tY':targetY, 'tZ':targetZ });

    if (!undoFlag) {
      this.lastTarget.push(new THREE.Vector3(targetX, targetY, targetZ));
    }

    while (stack.length !== 0) {
      const point = stack.pop();
      let openUp = false;
      let openDown = false;
      let openFar = false;
      let openClose = false;
      let xTmp = point.tX;
      while (this.getIntensity(xTmp, point.tY, point.tZ, undoFlag) >= intensityTarget) {
        xTmp--;
      }
      const leftBound = xTmp + 1;
      xTmp = point.tX;
      while (this.getIntensity(xTmp, point.tY, point.tZ, undoFlag) >= intensityTarget) {
        xTmp++;
      }
      const rightBound = xTmp - 1;
      for (xTmp = leftBound; xTmp <= rightBound; xTmp++) {
        this.changeIntensity(xTmp, point.tY, point.tZ, undoFlag);
        if (openUp === false) {
          if (this.getIntensity(xTmp, point.tY + 1, point.tZ, undoFlag) >= intensityTarget) {
            stack.push({ 'tX': xTmp, 'tY': (point.tY + 1), 'tZ': point.tZ });
            openUp = true;
          }
        } else if (this.getIntensity(xTmp, point.tY + 1, point.tZ, undoFlag) < intensityTarget) {
          openUp = false;
        }

        if (openDown === false) {
          if (this.getIntensity(xTmp, point.tY - 1, point.tZ, undoFlag) >= intensityTarget) {
            stack.push({ 'tX': xTmp, 'tY': (point.tY - 1), 'tZ': point.tZ });
            openDown = true;
          }
        } else if (this.getIntensity(xTmp, point.tY - 1, point.tZ, undoFlag) < intensityTarget) {
          openDown = false;
        }

        if (openFar === false) {
          if (this.getIntensity(xTmp, point.tY, point.tZ + 1, undoFlag) >= intensityTarget) {
            stack.push({ 'tX':xTmp, 'tY':point.tY, 'tZ':(point.tZ + 1) });
            openFar = true;
          }
        } else if (this.getIntensity(xTmp, point.tY, point.tZ + 1, undoFlag) < intensityTarget) {
          openFar = false;
        }

        if (openClose === false) {
          if (this.getIntensity(xTmp, point.tY, point.tZ - 1, undoFlag) >= intensityTarget) {
            stack.push({ 'tX':xTmp, 'tY':point.tY, 'tZ':(point.tZ - 1) });
            openClose = true;
          }
        } else if (this.getIntensity(xTmp, point.tY, point.tZ - 1, undoFlag) < intensityTarget) {
          openClose = false;
        }
      }
    }
    if (!undoFlag) {
      this.updatableTextureMask.needsUpdate = true;
    }
  }
  undoLastErasing() {
    if (this.lastMode.pop() === tools3dEraser.FILL) {
      const targetPoint = this.lastTarget.pop();
      const targetX = targetPoint.x;
      const targetY = targetPoint.y;
      const targetZ = targetPoint.z;
      this.erasePixelsFloodFill(targetX, targetY, targetZ, false, false, true);
    } else {
      if (this.lastSize.length === 0) {
        return;
      }
      const radiusRatio = this.xDim / this.zDim;
      const VAL_10 = 10;
      if (this.undocount === VAL_10) {
        this.lastSize = [];
        this.lastDepth = [];
        this.lastRotationVector = [];
        this.lastTarget = [];
        this.lastBackDistance = [];
        this.undocount = 0;
        //this.resetBufferTextureCPU();
        return;
      }
      this.undocount++;
      const targetLast = this.lastTarget.pop();
      const lastRotation = this.lastRotationVector.pop();
      const rxy = Math.round(this.lastSize.pop());
      const lastDepth = this.lastDepth.pop();
      const lastback = this.lastBackDistance.pop();
      this.point = new THREE.Vector3(0, 0, 0);
      this.queue = [];
      this.queue.push(this.point);
      while (this.queue.length > 0) {
        this.point = this.queue.pop();
        const RotPoint = this.point.clone();
        RotPoint.z *= radiusRatio;
        RotPoint.applyAxisAngle(new THREE.Vector3(1, 0, 0), lastRotation.x);
        RotPoint.applyAxisAngle(new THREE.Vector3(0, 1, 0), lastRotation.y);
        RotPoint.applyAxisAngle(new THREE.Vector3(0, 0, 1), lastRotation.z);
        if (Math.sqrt(RotPoint.x * RotPoint.x + RotPoint.y * RotPoint.y) > rxy ||
          RotPoint.z > lastDepth || RotPoint.z < lastback) {
          continue;
        }
        let offDst = 0;
        for (let x = this.point.x - 1; x <= this.point.x + 1; x++) {
          for (let y = this.point.y - 1; y <= this.point.y + 1; y++) {
            for (let z = this.point.z - 1; z <= this.point.z + 1; z++) {
              const mainX = targetLast.x + Math.round(x);
              const mainY = targetLast.y + Math.round(y);
              const mainZ = targetLast.z + Math.round(z);
              if (this.isWebGL2 === 0) {
                const yTile = Math.floor(mainZ / this.zDimSqrt);
                const xTile = mainZ - this.zDimSqrt * yTile;
                const yTileOff = (yTile * this.yDim) * this.xTex;
                const xTileOff = xTile * this.xDim;
                offDst = yTileOff + (mainY * this.xTex) + xTileOff + mainX;
              } else {
                offDst = mainX + mainY * this.xDim + mainZ * this.xDim * this.xDim;
              }
              if (this.bufferMask[offDst] === 0) {
                this.bufferMask[offDst] = 255.0;
                this.queue.push(new THREE.Vector3(x, y, z));
              }
            }
          }
        }
      }
    }
    this.updatableTextureMask.needsUpdate = true;
  }
  resetBufferTextureCPU() {
    //this.rendererBlur.render(this.sceneBlur, this.cameraOrtho, this.bufferTexture);
    //const gl = this.rendererBlur.getContext();
    //gl.readPixels(0, 0, this.xTex, this.yTex, gl.RGBA, gl.UNSIGNED_BYTE, this.bufferTextureCPU);
    //this.updatableTexture.needsUpdate = true; this.lastSize.push(size);
    if (this.isWebGL2 === 0) {
      for (let y = 0; y < this.yTex; y++) {
        for (let x = 0; x < this.xTex; x++) {
          this.bufferMask[x + y * this.xTex] = 255.0;
        }
      }
    } else {
      for (let z = 0; z < this.zDim; z++) {
        for (let y = 0; y < this.yDim; y++) {
          for (let x = 0; x < this.xDim; x++) {
            this.bufferMask[x + y * this.xDim + z * this.xDim * this.yDim] = 255;
          }
        }
      }
    }
    this.updatableTextureMask.needsUpdate = true;
  }
  /**
   * Create 2D texture containing roi color map
   * @param colorArray 256 RGBA roi colors
   */
  createRoiColorMap(colorArray) {
    return this.transferFunc.createRoiColorMap(colorArray);
  }
  /**
   * Create 2D texture containing selected ROIs
   * @param colorArray 256 RGBA roi colors
   */
  createSelectedRoiMap() {
    return this.createSelectedRoiMap();
  }
  /**
   * Create 2D texture containing selected ROIs
   * @param selectedROIs 256 byte roi values
   */
  updateSelectedRoiMap(selectedROIs) {
    this.transferFunc.updateSelectedRoiMap(selectedROIs);
    this.setVolumeTexture(1.0);
  }
  /**
   * Update roi selection map
   * @param roiId ROI id from 0..255
   * @param selectedState True if roi must be visible
   */
  // eslint-disable-next-line
  updateSelectedRoi(roiId, selectedState) {
    this.transferFunc.updateSelectedRoi(roiId, selectedState);
    this.setVolumeTexture(1.0);
  }
  /**
   * Create 3D texture containing filtered source data and calculated normal values
   * @param props An object that contains all volume-related info
   * @param

   * @param roiColors Array of roi colors in RGBA format
   * @return (object) Created texture
   */
  createUpdatableVolumeTex(props, isRoiVolume, roiColors) {
    //
    // Some notes about tetxure layout.
    // Actually we have replaces3d texture with 2d texture (large size).
    // Idea: pack 2d slices of original texture into single 2d texture, looking
    // like tile map
    //
    // Let we have 7 slices on z direction and want to create
    // 2d visualization in (x,y) plane.
    // We can arrange 7 slices in a following manner (ooo - means unused)
    //
    // +-----+-----+-----+
    // |     |     |     |
    // |  0  |  1  |  2  |
    // |     |     |     |
    // +-----+-----+-----+
    // |     |     |     |
    // |  3  |  4  |  5  |
    // |     |     |     |
    // +-----+-----+-----+
    // |     |00000|00000|
    // |  6  |00000|00000|
    // |     |00000|00000|
    // +-----+-----+-----+
    //
    // Numbers 0..6 inside tiles shows original tiles indices
    //
    // Shader parameter
    // tileCointX: number of tiles in hor direction
    // volumeSizeZ: number of slices in z directiion
    //
    // console.log(roiColors);
    this.isWebGL2 = props.isWebGL2;
    this.arrPixels = props.volume.m_dataArray;
    const xDim = props.volume.m_xDim;
    const yDim = props.volume.m_yDim;
    const zDim = props.volume.m_zDim;
    const TWO = 2;
    const ONE = 1;
    const zDimSqrt = TWO ** (ONE + Math.floor(Math.log(Math.sqrt(zDim)) / Math.log(TWO)));
    if (!Number.isInteger(zDimSqrt)) {
      console.log(`!!! zDimSqrt should be integer, but = ${zDimSqrt}`);
    }
    const xTex = xDim * zDimSqrt;
    const yTex = yDim * zDimSqrt;
    const numPixelsBuffer = xTex * yTex;
    this.numPixelsBuffer = numPixelsBuffer;
    this.xTex = xTex;
    this.yTex = yTex;
    this.xDim = xDim;
    this.yDim = yDim;
    this.zDim = zDim;
    this.zDimSqrt = zDimSqrt;
    this.isRoiVolume = isRoiVolume;

    this.RoiVolumeTex = null;
    if (!isRoiVolume) {
      if (this.isWebGL2 === 0) {
        this.setBufferRgbaFrom1Byte();
      } else {
        this.set3DTextureFrom1Byte();
      }
    } else {
      if (this.isWebGL2 === 0) {
        this.setBufferRgbaFrom4Bytes();
        this.RoiVolumeTex = new THREE.DataTexture(this.bufferRoi, this.xTex, this.yTex, THREE.AlphaFormat);
      } else {
        this.set3DTextureFrom4Bytes();
        this.RoiVolumeTex = new THREE.DataTexture3D(this.bufferRoi, this.xDim, this.yDim, this.zDim);
        this.RoiVolumeTex.format = THREE.RedFormat; //RedFormat?
        this.RoiVolumeTex.type = THREE.UnsignedByteType;
      }
      this.RoiVolumeTex.wrapS = THREE.ClampToEdgeWrapping;
      this.RoiVolumeTex.wrapT = THREE.ClampToEdgeWrapping;
      this.RoiVolumeTex.magFilter = THREE.NearestFilter;
      this.RoiVolumeTex.minFilter = THREE.NearestFilter;
      this.RoiVolumeTex.needsUpdate = true;
    }
    let rtFormat = THREE.RGBAFormat;
    if (this.isWebGL2 === 1) {
      rtFormat = THREE.RGBAFormat;// can we use ALPHA?
    }
    this.bufferTexture = new THREE.WebGLRenderTarget(this.xDim,
      this.yDim, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: rtFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: false,
      });

    if (this.origVolumeTex) {
      this.origVolumeTex.dispose();
    }

    if (this.isWebGL2 === 0) {
      this.origVolumeTex = new THREE.DataTexture(this.bufferR, this.xTex, this.yTex, THREE.AlphaFormat);
    } else {
      this.origVolumeTex = new THREE.DataTexture3D(this.bufferR, this.xDim, this.yDim, this.zDim);
      this.origVolumeTex.format = THREE.RedFormat;
      this.origVolumeTex.type = THREE.UnsignedByteType;
      this.origVolumeTex.wrapR = THREE.ClampToEdgeWrapping;
    }
    this.origVolumeTex.wrapS = THREE.ClampToEdgeWrapping;
    this.origVolumeTex.wrapT = THREE.ClampToEdgeWrapping;

    this.origVolumeTex.magFilter = THREE.NearestFilter;//THREE.LinearFilter;
    this.origVolumeTex.minFilter = THREE.NearestFilter;//THREE.LinearFilter;

    this.origVolumeTex.needsUpdate = true;
    if (this.origVolumeTex) {
      this.origVolumeTex.dispose();
    }

    if (this.isWebGL2 === 0) {
      this.updatableTexture = new THREE.DataTexture(this.bufferTextureCPU, this.xTex, this.yTex, THREE.AlphaFormat);
    } else {
      let volTexFormat = THREE.RedFormat;
      if (isRoiVolume) {
        volTexFormat = THREE.RGBAFormat;
      }
      this.updatableTexture = new THREE.DataTexture3D(this.bufferTextureCPU, this.xDim, this.yDim, this.zDim);
      this.updatableTexture.format = volTexFormat;
      this.updatableTexture.type = THREE.UnsignedByteType;
      this.updatableTexture.wrapR = THREE.ClampToEdgeWrapping;
    }
    this.updatableTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.updatableTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.updatableTexture.magFilter = THREE.LinearFilter;
    this.updatableTexture.minFilter = THREE.LinearFilter;
    if (this.zDim > 1) {
      this.initRenderer(isRoiVolume, roiColors);
    }
    this.updatableTexture.needsUpdate = true;
    return this.updatableTexture;
  }
  /**
   * Create 3D texture containing mask of data which were erase
   * @param volume An object that contains all volume-related info
   * @return (object) Created texture
   */
  createUpdatableVolumeMask(volume) {
    const xDim = volume.m_xDim;
    const yDim = volume.m_yDim;
    if (this.isWebGL2 === 0) {
      const xTex = xDim * this.zDimSqrt;
      const yTex = yDim * this.zDimSqrt;
      const numPixelsBuffer = xTex * yTex;
      this.bufferMask = new Uint8Array(numPixelsBuffer);
      for (let y = 0; y < yTex; y++) {
        const yOff = y * xTex;
        for (let x = 0; x < xTex; x++) {
          this.bufferMask[x + yOff] = 255;
        }
      }
    } else {
      this.bufferMask = new Uint8Array(this.xDim * this.yDim * this.zDim);
      for (let z = 0; z < this.zDim; z++) {
        for (let y = 0; y < this.yDim; y++) {
          for (let x = 0; x < this.xDim; x++) {
            this.bufferMask[x + y * this.xDim + z * this.xDim * this.yDim] = 255;
          }
        }
      }
    }

    if (this.updatableTextureMask) {
      this.updatableTextureMask.dispose();
    }
    //this.updatableTextureMask = new THREE.DataTexture(this.bufferMask, this.xTex, this.yTex, THREE.AlphaFormat);
    this.updatableTextureMask = new THREE.DataTexture3D(this.bufferMask, this.xDim, this.yDim, this.zDim);
    this.updatableTextureMask.format = THREE.RedFormat;
    this.updatableTextureMask.type = THREE.UnsignedByteType;
    this.updatableTextureMask.wrapS = THREE.ClampToEdgeWrapping;
    this.updatableTextureMask.wrapT = THREE.ClampToEdgeWrapping;
    this.updatableTextureMask.magFilter = THREE.LinearFilter;
    this.updatableTextureMask.minFilter = THREE.LinearFilter;
    this.updatableTextureMask.needsUpdate = true;

    const maskGaussingBufferSize = 131072;
    this.maskGaussingBufferSize = maskGaussingBufferSize;
    this.maskGaussingTempBuf = new Uint8Array(maskGaussingBufferSize);
    return this.updatableTextureMask;
    //this.initRenderer(isRoiVolume, roiColors);
    //return this.bufferTexture.texture;
  }
} // class Graphics3d
