// Only touches direct-upload videos recorded in TSC's publishing ledger.
// Dry run by default. Never copies third-party profile video URLs.
import 'dotenv/config';
import '../config/cloudinary.js';
import mongoose from 'mongoose';
import Video from '../models/musicianVideoSubmissionModel.js';
import Musician from '../models/musicianModel.js';
import { publicMusician, getMusicianConnections } from '../services/musicianConnectionsService.js';
import { buildAnonymousYoutubeMetadata, updateYoutubeVideoMetadata, setYoutubeVideoThumbnail, youtubeVisibility } from '../services/youtubeVideoService.js';
import { thumbnailMediaUrl } from '../services/musicianVideoThumbnailService.js';
await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
let failures = 0;
try {
  for (const video of await Video.find({status:'published', youtubeVideoId:{$nin:['',null]}})) {
    const musician = await Musician.findById(video.musicianId);
    if (!musician || (!publicMusician(musician) && !musician.privateTestProfile)) { console.log(JSON.stringify({id:String(video._id),skipped:'Profile is not publicly approved'})); continue; }
    if (video.thumbnailPublicId && video.thumbnailReviewStatus !== 'approved') { console.log(JSON.stringify({id:String(video._id),skipped:'Thumbnail needs approval'})); continue; }
    const connections = await getMusicianConnections(musician,{includeMusicians:false});
    const metadata = buildAnonymousYoutubeMetadata({musician,submission:video,bands:[...connections.regularBands,...connections.deputyBands]});
    const privacyStatus = youtubeVisibility(musician);
    if (!process.argv.includes('--apply')) { console.log(JSON.stringify({id:String(video._id),title:metadata.title,privacyStatus,description:metadata.description,tags:metadata.tags})); continue; }
    try {
      await setYoutubeVideoThumbnail({videoId:video.youtubeVideoId,mediaUrl:await thumbnailMediaUrl(video)});
      await updateYoutubeVideoMetadata({videoId:video.youtubeVideoId,metadata,privacyStatus});
      video.youtubeMetadata=metadata;video.youtubePrivacyStatus=privacyStatus;video.youtubeTitle=metadata.title;video.error='';await video.save();
      const field=video.category==='original'?'tscApprovedOriginalBandVideoLinks':'tscApprovedFunctionBandVideoLinks';
      for(const link of musician[field]||[])if(link.url===video.youtubeUrl)link.title=metadata.title;
      await musician.save();
      console.log(JSON.stringify({id:String(video._id),title:metadata.title,privacyStatus,synced:true}));
    } catch(error) { failures++;console.error(JSON.stringify({id:String(video._id),error:error.message})); }
  }
} finally { await mongoose.disconnect(); }
if(failures)process.exitCode=1;
