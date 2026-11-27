import test from 'node:test';import assert from 'node:assert/strict';import {actCardImage} from '../utils/actCardImage.js';
test('selected profile photo beats landscape cover/gallery in card payloads',()=>{assert.equal(actCardImage({profileImage:[{url:'profile'}],images:[{url:'gallery'}],coverImage:[{url:'cover'}]}),'profile');});
test('legacy and missing profile images have usable fallbacks',()=>{assert.equal(actCardImage({profileImage:[{url:''}],images:['gallery']}),'gallery');assert.equal(actCardImage({coverImage:{url:'cover'}}),'cover');assert.equal(actCardImage({}), '');});
