# WordPress integration

VideoWhisper bundles this recorder in two WordPress plugins:

- [Video Posts Webcam Recorder](https://wordpress.org/plugins/video-posts-webcam-recorder/) adds recordings to WordPress post and video-sharing workflows.
- [Video Comments Webcam Recorder](https://wordpress.org/plugins/video-comments-webcam-recorder/) adds recordings to WordPress comments and comment forms.

Both plugins use the same browser recorder assets. Their recorder settings select the available capture types and their integration settings decide whether accepted media is saved to the WordPress Media Library. Video workflows can optionally pass accepted videos to compatible VideoWhisper video-sharing integrations; audio, photos, and screenshots remain Media Library items.

## Available capture types

When the bundled recorder is selected, plugin settings can expose these actions:

- Webcam video
- Microphone audio
- Screen capture, optionally with microphone audio
- Webcam photo
- Screenshot

The recorder asks for only the browser permissions required by the selected action. Browsers may not provide every input device or codec, so integrations should use the accepted result and its reported media information rather than assuming a fixed format.

## Add the recorder to a page

The recorder plugins provide their own shortcodes and controls. In a custom WordPress integration, use the plugin's documented recorder shortcode and pass the desired capture type or enabled types. Enable the direct-preview setting when the page should open the selected capture preview without the introductory screen.

Accepted results include the upload URL or WordPress attachment information and browser-reported media metadata. A custom integration can use that data to store an attachment reference, display the item, or redirect the user after a successful upload.

## Update the bundled recorder assets

From a checkout that contains this recorder and the two WordPress plugin folders:

```bash
npm install
npm run build
npm run sync:wp-recorder-assets
```

The sync command copies the production browser JavaScript and CSS into each plugin's `trunk/recorder/` directory and removes development source maps from the distributed plugin assets. Review the resulting plugin changes, run each plugin's checks, and commit or publish the plugin updates independently of this recorder repository.

## Plugin testing checklist

1. Enable the capture types needed by the page or comment form.
2. Record, review, accept, and upload each enabled type.
3. Confirm the Media Library item and its media information when Media Library integration is enabled.
4. Confirm any configured video-sharing integration receives accepted video only.
5. Test the direct-preview option, any configured success redirect, and a browser that denies a requested device permission.
