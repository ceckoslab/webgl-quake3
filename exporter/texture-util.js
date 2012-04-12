/*
 * Copyright (c) 2009 Brandon Jones
 *
 * This software is provided 'as-is', without any express or implied
 * warranty. In no event will the authors be held liable for any damages
 * arising from the use of this software.
 *
 * Permission is granted to anyone to use this software for any purpose,
 * including commercial applications, and to alter it and redistribute it
 * freely, subject to the following restrictions:
 *
 *    1. The origin of this software must not be misrepresented; you must not
 *    claim that you wrote the original software. If you use this software
 *    in a product, an acknowledgment in the product documentation would be
 *    appreciated but is not required.
 *
 *    2. Altered source versions must be plainly marked as such, and must not
 *    be misrepresented as being the original software.
 *
 *    3. This notice may not be removed or altered from any source
 *    distribution.
 */

var fs = require("fs");
var path = require('path');
var Canvas = require("canvas");

function nextPowerOfTwo(n) {
    --n;
    n = n | (n >> 1);
    n = n | (n >> 2);
    n = n | (n >> 4);
    n = n | (n >> 8);
    n = n | (n >> 16);
    return ++n;
}

function decodeTga(content) {
    var contentOffset = 18 + content[0];  //[0] = size of ID field
    var imagetype = content[2]; // 0=none,1=indexed,2=rgb,3=grey,+8=rle packed
    var width = content[13]*256 + content[12];
    var height = content[15]*256 + content[14];
    var bpp = content[16];  // should be 8,16,24,32
    
    var bytesPerPixel = bpp / 8;
    var bytesPerRow = width * bytesPerPixel;
    var byteCount = width * height * bytesPerPixel;

    var blueOffset = 0;
    var greenOffset = 1;
    var redOffset = 2;
    var alphaOffset = 3;

    if(!width || !height) {
        console.log("Invalid dimensions");
        return null;
    }

    if (imagetype != 2) {
        console.log("Unsupported TGA format:", imagetype);
        return null;
    }

    var canvas = new Canvas(width, height);
    var ctx = canvas.getContext('2d');
    var imageData = ctx.createImageData(width, height);

    var i = contentOffset, j, x, y;

    var validAlpha = 0;

    // Oy, with the flipping of the rows...
    for(y = height-1; y >= 0; --y) {
        for(x = 0; x < width; ++x, i += bytesPerPixel) {
            j = (x * bytesPerPixel) + (y * bytesPerRow);
            imageData.data[j] = content[i+redOffset];
            imageData.data[j+1] = content[i+greenOffset];
            imageData.data[j+2] = content[i+blueOffset];
            imageData.data[j+3] = (bpp === 32 ? content[i+alphaOffset] : 255);
            validAlpha = validAlpha || imageData.data[j+3];
        }
    }

    // This really sucks, but occasionally an image will come through with nothing but 0s in the alpha channel
    // The canvas stream to PNG premultiplies the alpha values, and so the image comes out empty
    // I'm not sure this is the right way to fix it, but it seems to work for the moment
    if(!validAlpha) {
        i = imageData.data.length;
        for(j = 3; j < i; j += 4) {
            imageData.data[j] = 255;
        }
    }

    ctx.putImageData(imageData, 0, 0);

    return canvas;
}

function ensureFilePathExists(filePath) {
    if(!filePath) { return; }

    var idx = filePath.lastIndexOf("/");
    var dir = filePath.substring(0, idx);

    if(dir) {
        ensureDirExists(dir);
    }
}

function ensureDirExists(dirPath) {
    if(!dirPath || path.existsSync(dirPath)) { return; }

    var idx = dirPath.lastIndexOf("/");
    var dir = dirPath.substring(0, idx);

    if(dir) {
        ensureDirExists(dir);
    }

    if(idx != dirPath.length - 1) {
        try {
            fs.mkdirSync(dirPath);
        } catch(ex) {
            // Don't care if the dir already exists
        }
    }
}

function exportTexture(outputFolder, name, pak) {
    var ext;

    // Don't re-write if there's already a texture there
    if(path.existsSync(outputFolder + "/" + name + ".jpg")) {
        return name + ".jpg";
    }
    if(path.existsSync(outputFolder + "/" + name + ".png")) {
        return name + ".png";
    }

    var entry = pak.findFile(new RegExp(name + ".*$"));

    if(entry) {
        ext = entry.name.substring(entry.name.length - 3);
        if(ext === "jpg") {
            return exportJpg(outputFolder, entry);
        } else if(ext === "tga") {
            return exportTga(outputFolder, entry);
        } else {
            console.log("Unknown Texture type:", entry.name);
        }
    } else {
        console.log("No Texture found:", name);
    }

    return null;
}

function exportJpg(outputFolder, entry) {
    var exportPath = outputFolder + "/" + entry.name;
    var file;

    console.log("Exporting:", entry.name);
    ensureFilePathExists(exportPath);

    file = entry.pak.readFileSync(entry.name);

    // It's unfortunate that we have to do this, but not all Quake 3 textures are powers of two
    /*var img = new Canvas.Image();
    img.src = exportPath;

    console.log("Texture Dimensions:", entry.name, img.width, "*", img.height);

    var potWidth = nextPowerOfTwo(img.width);
    var potHeight = nextPowerOfTwo(img.height);

    if(potWidth != img.width || potHeight != img.height) {
        console.log("Found NPOT texture, resizing:", img.width, "*", img.height);
        // NPOT, Resize!
        var canvas = new Canvas(potWidth, potHeight);
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, potWidth, potHeight);

        writeCanvasToJpg(outputFolder, entry.name, canvas);
    } else { */
        fs.writeFileSync(exportPath, file);
    //}

    return entry.name;
}

function exportTga(outputFolder, entry) {
    //var img = new Canvas.Image();
    var name = entry.name.replace(".tga", ".png");
    var exportPath = outputFolder + "/" + name;
    var file;

    console.log("Exporting:", entry.name);
    ensureFilePathExists(exportPath);

    file = entry.pak.readFileSync(entry.name);

    canvas = decodeTga(file);

    if(canvas) {
        writeCanvasToPng(outputFolder, name, canvas);
    }

    return name;
}

exports.exportTextures = function(outputFolder, shaders, data, lightmapPath, pak) {
    var material, shader, stage, exportedName, i, j, k;
    for(i = 0; i < data.materials.length; ++i) {
        material = data.materials[i];

        shader = shaders[material.shaderName];
        if(shader) {
            for(j in shader.stages) {
                stage = shader.stages[j];
                if(stage.map === "anim") {
                    for(k in stage.animMaps) {
                        stage.animMaps[k] = exportTexture(outputFolder, stage.animMaps[k], pak);
                    }
                } else if (stage.map === "$lightmap") {
                    stage.map = lightmapPath;
                } else {
                    stage.map = exportTexture(outputFolder, stage.map, pak);
                }
            }
        } else {
            // Need to do something with the exported name. It's important, includes extension;
            material.shaderName = exportTexture(outputFolder, material.shaderName, pak);
        }
    }
};

var writeCanvasToPng = exports.writeCanvasToPng = function(outputFolder, name, canvas) {
    // Write compiled lightmap out to PNG
    ensureFilePathExists(outputFolder + "/" + name);
    var out = fs.createWriteStream(outputFolder + "/" + name);
    var stream = canvas.createPNGStream();
    stream.on('data', function(chunk){
        out.write(chunk);
    });
};

var writeCanvasToJpg = exports.writeCanvasToJpg = function(outputFolder, name, canvas) {
    // Write compiled lightmap out to JPG
    ensureFilePathExists(outputFolder + "/" + name);
    var out = fs.createWriteStream(outputFolder + "/" + name);
    var stream = canvas.createJPEGStream();
    stream.on('data', function(chunk){
        out.write(chunk);
    });
};