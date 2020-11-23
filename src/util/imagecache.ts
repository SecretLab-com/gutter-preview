import * as tmp from 'tmp';
import fetch from 'node-fetch';
import * as path from 'path';
import * as url from 'url';
import * as fs from 'fs';
import { copyFile } from './fileutil';
import { promisify } from 'util';

tmp.setGracefulCleanup();

let imageCache: Map<String, Thenable<string>> = new Map();
let currentColor: string;
export const ImageCache = {
    setCurrentColor: (color: string) => {
        if (currentColor != color) {
            currentColor = color;
            imageCache.clear();
        }
    },
    delete: (key: string) => {
        imageCache.delete(key);
    },
    set: (key: string, value: Thenable<string>) => {
        imageCache.set(key, value);
    },
    get: (key: string) => {
        return imageCache.get(key);
    },
    has: (key: string) => {
        return imageCache.has(key);
    },
    store: (absoluteImagePath: string): Thenable<string> => {
        const currentColorForClojure: string = currentColor;
        if (ImageCache.has(absoluteImagePath)) {
            return ImageCache.get(absoluteImagePath);
        } else {
            try {
                const absoluteImageUrl = url.parse(absoluteImagePath);
                const anExt = absoluteImageUrl.pathname ? path.parse(absoluteImageUrl.pathname).ext : 'png';
                const tempFile = tmp.fileSync({
                    postfix: absoluteImageUrl.pathname.endsWith('.tsx') ? anExt+'.svg' : anExt,
                });
                const filePath = tempFile.name;
                const promise = new Promise<string>((resolve, reject) => {
                    if (absoluteImageUrl.protocol && absoluteImageUrl.protocol.startsWith('http')) {
                        fetch(new url.URL(absoluteImagePath).toString())
                            .then((resp) => {
                                if (!resp.ok) {
                                    reject(resp.statusText);
                                    return;
                                }
                                const dest = fs.createWriteStream(filePath);
                                resp.body.pipe(dest);
                                resp.body.on('error', (err) => {
                                    reject(err);
                                });
                                dest.on('finish', function () {
                                    resolve(filePath);
                                });
                            })
                            .catch((err) => reject(err));
                    } else {
                        try {
                            const handle = fs.watch(absoluteImagePath, function fileChangeListener() {
                                handle.close();
                                fs.unlink(filePath, () => {});
                                ImageCache.delete(absoluteImagePath);
                            });
                        } catch (e) {}
                        copyFile(absoluteImagePath, filePath, (err) => {
                            if (!err) {
                                resolve(filePath);
                            }
                        });
                    }
                });
                ImageCache.set(absoluteImagePath, promise);
                const injectStyles = (path: string) => {
                    return new Promise<string>((res, rej) => {
                        if (path.endsWith('.tsx.svg')) 
                        {
                            const read = promisify(fs.readFile);
                            const write = promisify(fs.writeFile);

                            read(path)
                                .then((data) => {
                                    const original = data.toString('utf-8');
                                    return original
                                            // .replace(/([\n\r]\s+)\*(\s+)/g,"$1$2")
                                            .replace(/[\n\r][\s?/]*\*/g,"\n")
                                            .replace(/.*?ORIGINAL SVG.*?-{10,}(.*?)-{10,}.*/s,"$1");
                                })
                                .then((data) => {
                                    return data.replace('<svg', `<svg style="color:${currentColorForClojure}"`);
                                })
                                .then((data) => {
                                    return write(path, data);
                                })
                                .then(() => res(path))
                                .catch((err) => rej(err));
                        } else if (path.endsWith('.svg') && currentColorForClojure && currentColorForClojure != '') {
                            const read = promisify(fs.readFile);
                            const write = promisify(fs.writeFile);

                            read(path)
                                .then((data) => {
                                    const original = data.toString('utf-8');
                                    return original.replace('<svg', `<svg style="color:${currentColorForClojure}"`);
                                })
                                .then((data) => {
                                    return write(path, data);
                                })
                                .then(() => res(path))
                                .catch((err) => rej(err));
                        } else 
                        {
                            res(path);
                        }
                    });
                };
                return promise.then((p) => injectStyles(p));
            } catch (error) {}
        }
    },

    cleanup: () => {
        imageCache.forEach((value) => {
            value.then((tmpFile) => fs.unlink(tmpFile, () => {}));
        });
        imageCache.clear();
    },
};
