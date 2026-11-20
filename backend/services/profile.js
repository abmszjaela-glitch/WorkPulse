import sharp from 'sharp';
import { ApiError } from '../utils/api-error.js';

export function createProfileService({ repository }) {
  return {
    run: (actor,action,data) => repository.profile(actor,action,data),
    async avatar(actor, encoded) {
      if (typeof encoded !== 'string' || encoded.length > 350000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
        throw new ApiError(400,'Provide a valid PNG or JPEG image under 256 KiB');
      }
      let output;
      try {
        const input = Buffer.from(encoded,'base64');
        if (!input.length || input.length > 256 * 1024) throw new Error();
        const png = input.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
        const jpeg = input[0]===255 && input[1]===216 && input[2]===255;
        if(!png&&!jpeg)throw new Error();
        const image = sharp(input,{limitInputPixels:4000000,failOn:'warning'});
        const metadata = await image.metadata();
        if (!['png','jpeg'].includes(metadata.format) || (metadata.pages || 1)>1) throw new Error();
        output = await image.rotate().resize(256,256,{fit:'cover',withoutEnlargement:true}).png().toBuffer();
        if(output.length>256*1024)throw new Error();
      } catch { throw new ApiError(400,'Invalid or oversized PNG/JPEG image'); }
      return repository.profile(actor,'avatar',{avatarBase64:output.toString('base64')});
    },
  };
}
