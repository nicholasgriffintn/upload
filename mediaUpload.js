'use strict';
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const Jimp = require('jimp');
const s3 = new AWS.S3();
const formParser = require('./formParser');

const bucket = process.env.Bucket;
const MAX_SIZE = 4500000; // 4MB

const PNG_MIME_TYPE = 'image/png';
const JPEG_MIME_TYPE = 'image/jpeg';
const JPG_MIME_TYPE = 'image/jpg';
const WEBP_MIME_TYPE = 'image/webp';
const ICON_MIME_TYPE = 'image/vnd.microsoft.icon';
const MP3_MIME_TYPE = 'audio/mpeg';
const MP4_MIME_TYPE = 'video/mp4';
const MPEG_MIME_TYPE = 'video/mpeg';
const OGG_A_MIME_TYPE = 'audio/ogg';
const OGG_V_MIME_TYPE = 'video/ogg';
const PDF_MIME_TYPE = 'application/pdf';
const WEBM_A_MIME_TYPE = 'audio/webm';
const WEBM_V_MIME_TYPE = 'video/webm';

const MIME_TYPES = [
  PNG_MIME_TYPE,
  JPEG_MIME_TYPE,
  JPG_MIME_TYPE,
  ICON_MIME_TYPE,
  MP3_MIME_TYPE,
  MP4_MIME_TYPE,
  MPEG_MIME_TYPE,
  OGG_A_MIME_TYPE,
  OGG_V_MIME_TYPE,
  PDF_MIME_TYPE,
  WEBM_A_MIME_TYPE,
  WEBM_V_MIME_TYPE,
  WEBP_MIME_TYPE,
];

const getErrorMessage = (message) => ({
  statusCode: 500,
  headers: {
    'Access-Control-Allow-Origin': '*', // Required for CORS support to work
    'Access-Control-Allow-Credentials': true, // Required for CORS support to work
  },
  body: JSON.stringify({
    message,
  }),
});

const isAllowedSize = (size) => size <= MAX_SIZE;

const isAllowedMimeType = (mimeType) =>
  MIME_TYPES.find((type) => type === mimeType);

const isAllowedFile = (size, mimeType) =>
  isAllowedSize(size) && isAllowedMimeType(mimeType);

const uploadToS3 = (bucket, key, buffer, mimeType) =>
  new Promise((resolve, reject) => {
    s3.upload(
      {
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      },
      function (err, data) {
        if (err) reject(err);
        resolve(data);
      }
    );
  });

// JIMP: https://www.npmjs.com/package/jimp
/*
RESIZE:
image.contain( w, h[, alignBits || mode, mode] );    // scale the image to the given width and height, some parts of the image may be letter boxed
image.cover( w, h[, alignBits || mode, mode] );      // scale the image to the given width and height, some parts of the image may be clipped
image.resize( w, h[, mode] );     // resize the image. Jimp.AUTO can be passed as one of the values.
image.scale( f[, mode] );         // scale the image by the factor f
image.scaleToFit( w, h[, mode] ); // scale the image to the largest size that fits inside the given width and height
 
CROP:
image.autocrop([tolerance, frames]); // automatically crop same-color borders from image (if any), frames must be a Boolean
image.autocrop(options);          // automatically crop same-color borders from image (if any), options may contain tolerance, cropOnlyFrames, cropSymmetric, leaveBorder
image.crop( x, y, w, h );         // crop to the given region
*/
const resize = (buffer, mimeType, width, height, quality) =>
  new Promise((resolve, reject) => {
    Jimp.read(buffer)
      .then((image) =>
        image
          .resize(width || Jump.AUTO, height || Jimp.AUTO)
          .getBufferAsync(mimeType)
      )
      .then((resizedBuffer) => resolve(resizedBuffer))
      .catch((error) => reject(error));
  });

module.exports.handler = async (event) => {
  try {
    let formData = {};

    // TODO: Use this data to make sure the user can upload
    const authorizer = event.requestContext.authorizer;

    console.log('Returned authentication', authorizer);

    if (event.direct === true) {
      formData = event;
    } else {
      formData = await formParser.parser(event, MAX_SIZE);
    }

    const {
      linkID = 'temp',
      siteID = 'DefaultCompany',
      uploadType = 'media',
    } = formData;

    let {
      uploadSizes = [
        {
          type: 'full',
        },
      ],
    } = formData;

    if (formData && formData.files) {
      let file = formData.files;

      if (formData.files[0]) {
        file = formData.files[0];
      }

      if (!file || !file.content) {
        return getErrorMessage('No file or file content was supplied');
      }

      if (!isAllowedFile(file.content.byteLength, file.contentType)) {
        return getErrorMessage('File size or type not allowed');
      }

      const uid = uuidv4();

      const folderKey = `${siteID}/${uploadType}/${linkID}`;

      if (!uploadSizes && uploadSizes.length <= 0) {
        return getErrorMessage('No image sizes were provided');
      }

      if (typeof uploadSizes === 'string') {
        uploadSizes = JSON.parse(uploadSizes);
      }

      return await Promise.all(
        uploadSizes.map(async (size) => {
          const sizeSanitized = size.type
            .toLowerCase()
            .replace(/ /g, '_')
            .replace(/[^\w-]+/g, '.');

          const filenameSanitized = file.filename
            .toLowerCase()
            .replace(/ /g, '_')
            .replace(/[^\w-]+/g, '.');

          const fileKey = `${folderKey}/${uid}_${sizeSanitized}_${filenameSanitized}`;

          if (size.width || size.height) {
            const fileResizedBuffer = await resize(
              file.content,
              file.contentType,
              size.width,
              size.height,
              size.quality || 80
            );

            const [fileUploadData] = await Promise.all([
              uploadToS3(bucket, fileKey, fileResizedBuffer, file.contentType),
            ]);

            /* const signedUrl = s3.getSignedUrl("getObject", {
              Bucket: fileUploadData.Bucket,
              Key: fileKey,
              Expires: 60000
            }); */

            return {
              mimeType: file.contentType,
              originalKey: fileUploadData.key,
              bucket: fileUploadData.Bucket,
              fileName: file.filename,
              signedUrl: null,
              cdnUrl: `https://cdn2.example.com/${fileUploadData.key}`,
              originalSize: file.content.byteLength,
            };
          } else {
            const [fileUploadData] = await Promise.all([
              uploadToS3(bucket, fileKey, file.content, file.contentType),
            ]);

            /* const signedUrl = s3.getSignedUrl("getObject", {
              Bucket: fileUploadData.Bucket,
              Key: fileKey,
              Expires: 60000
            }); */

            return {
              mimeType: file.contentType,
              originalKey: fileUploadData.key,
              bucket: fileUploadData.Bucket,
              fileName: file.filename,
              signedUrl: null,
              cdnUrl: `https://cdn2.example.com/${fileUploadData.key}`,
              originalSize: file.content.byteLength,
            };
          }
        })
      )
        .then((data) => {
          return {
            statusCode: 200,
            headers: {
              'Access-Control-Allow-Origin': '*', // Required for CORS support to work
              'Access-Control-Allow-Credentials': true, // Required for CORS support to work
            },
            body: JSON.stringify({
              id: uid,
              uploadedFiles: data,
            }),
          };
        })
        .catch((err) => {
          return getErrorMessage(err.message);
        });
    } else {
      return getErrorMessage('Form parser returned no files');
    }
  } catch (e) {
    return getErrorMessage(e.message);
  }
};
