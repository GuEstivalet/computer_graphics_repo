
"use strict";

var vertexShaderSource = `#version 300 es
    in vec2 a_position;
    uniform mat3 u_matrix;

    void main() {
        gl_Position = vec4((u_matrix * vec3(a_position, 1)).xy, 0, 1);
    }`;
    
var fragmentShaderSource = `#version 300 es
    precision highp float;

    uniform vec4 u_color;

    out vec4 outColor;

    void main() {
        outColor = u_color;
    }`;


function main( ) {
    var canvas = document.querySelector("#canvas");
    var gl = canvas.getContext("webgl2");
    
    var vertexShader = CreateShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    var fragmentShader = CreateShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    var program = createProgram(gl, vertexShader, fragmentShader);
    gl.useProgram(program);
    gl.clearColor(0, 0, 0, 0);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    
    var positionLocation = gl.getAttribLocation(program, "a_position" );
    var matrixLocation = gl.getUniformLocation( program , "u_matrix" );
    var colorLocation = gl.getUniformLocation( program , "u_color");

    var quantityOfObjs = 2
    var translationsOrigins = [ [ 200 , 200 ] , [ 500 , 200 ] ];
    var moveOrigin = [ m3.translacao(-75,-55) , m3.translacao(-50, -75) ];
    var translations = translationsOrigins;
    var rotationsOrigins = [ 0 , 0 ];
    var rotationSpeed =[0 , 1 ];
    var rotations = rotationsOrigins;
    var scalesOrigins = [ [ Math.random()%2 , Math.random()%2 ] , [ 1 , 1 ] ];
    var scales = scalesOrigins;
    var colors = [ [Math.random(), Math.random(), Math.random(), 1] , [Math.random(), Math.random(), Math.random(), 1] ];
    
    var positionBuffer = gl.createBuffer();
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.enableVertexAttribArray(positionLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

    var size = 2;          // 2 components per iteration
    var type = gl.FLOAT;   // the data is 32bit floats
    var normalize = false; // don't normalize the data
    var stride = 0;        // 0 = move forward size * sizeof(type) each iteration to get the next position
    var offset = 0;        // start at the beginning of the buffer
    gl.vertexAttribPointer( positionLocation, size, type, normalize, stride, offset);

    gl.canvas.width = canvas.width;
    gl.canvas.height = canvas.height;

    var then = 0;

    requestAnimationFrame(DrawScene);

    function DrawScene( now ) {
        let matrix;
        let primitiveType = gl.TRIANGLES;
        let offset = 0;
        let count = 18; 
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(program);
        gl.bindVertexArray(vao);
        
        SetGeometry(gl);

        now *= 0.0025;
        var tempo = now - then;
        then = now;

        for ( let index = 0; index < quantityOfObjs ; index++ ) {
          rotations[index] = rotationsOrigins[index] + rotationSpeed[index] * tempo ;
          matrix = m3.identidade();
          matrix = m3.mult( matrix , m3.projecao( gl.canvas.width , gl.canvas.height ));
          matrix = m3.mult( matrix , m3.translacao( translations[index][0] , translations[index][1] ) );
          matrix = m3.mult( matrix , m3.rotacao( rotations[index] ) );
          matrix = m3.mult( matrix , m3.escala( scales[index][0] , scales[index][1] ) );
          matrix = m3.mult( matrix , moveOrigin[index] );
          gl.uniform4fv(colorLocation, colors[index]);
          gl.uniformMatrix3fv(matrixLocation, false, matrix);
          
          gl.drawArrays(primitiveType, offset, count);
        }
        requestAnimationFrame(DrawScene);
    }
}

function SetGeometry(gl) {
  gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
          // left column
          0, 0,
          30, 0,
          0, 150,
          0, 150,
          30, 0,
          30, 150,
 
          // top rung
          30, 0,
          100, 0,
          30, 30,
          30, 30,
          100, 0,
          100, 30,
 
          // middle rung
          30, 60,
          67, 60,
          30, 90,
          30, 90,
          67, 60,
          67, 90]),
      gl.STATIC_DRAW);
}

function CreateShader(gl, type, source) {
  let shader = gl.createShader( type );
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  let success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
  if (success) {
    return shader;
  }

  console.log(gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
}

function createProgram(gl, vertexShader, fragmentShader) {
  let program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  let success = gl.getProgramParameter(program, gl.LINK_STATUS);
  if (success) {
    return program;
  }
 
  console.log(gl.getProgramInfoLog(program));
  gl.deleteProgram(program);
}

var m3 = {
  translacao: function(tx, ty) {
    return [
      1.2, 0, 0,
      0, 1.2, 0,
      tx, ty, 1,
    ];
  },
 
  rotacao: function(angleInRadians) {
    var c = Math.cos(angleInRadians);
    var s = Math.sin(angleInRadians);
    return [
      c,-s, 0,
      s, c, 0,
      0, 0, 1,
    ];
  },
 
  escala: function(sx, sy) {
    return [
      sx, 0, 0,
      0, sy, 0,
      0, 0, 1,
    ];
  },

  identidade: function() {
    return [
        1 , 0 , 0,
        0 , 1 , 0,
        0 , 0 , 1,
    ];
  },

  projecao: function (width, height) {
    return [
      2 / width, 0, 0,
      0, -2 / height, 0,
      -1, 1, 1,
    ];
  },
  mult: function(a, b) {
    var a00 = a[0 * 3 + 0];
    var a01 = a[0 * 3 + 1];
    var a02 = a[0 * 3 + 2];
    var a10 = a[1 * 3 + 0];
    var a11 = a[1 * 3 + 1];
    var a12 = a[1 * 3 + 2];
    var a20 = a[2 * 3 + 0];
    var a21 = a[2 * 3 + 1];
    var a22 = a[2 * 3 + 2];
    var b00 = b[0 * 3 + 0];
    var b01 = b[0 * 3 + 1];
    var b02 = b[0 * 3 + 2];
    var b10 = b[1 * 3 + 0];
    var b11 = b[1 * 3 + 1];
    var b12 = b[1 * 3 + 2];
    var b20 = b[2 * 3 + 0];
    var b21 = b[2 * 3 + 1];
    var b22 = b[2 * 3 + 2];
 
    return [
      b00 * a00 + b01 * a10 + b02 * a20,
      b00 * a01 + b01 * a11 + b02 * a21,
      b00 * a02 + b01 * a12 + b02 * a22,
      b10 * a00 + b11 * a10 + b12 * a20,
      b10 * a01 + b11 * a11 + b12 * a21,
      b10 * a02 + b11 * a12 + b12 * a22,
      b20 * a00 + b21 * a10 + b22 * a20,
      b20 * a01 + b21 * a11 + b22 * a21,
      b20 * a02 + b21 * a12 + b22 * a22,
    ];
  }
};

main();
