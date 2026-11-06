import { buildOriginalsEmail } from './originalsEmailTemplate.js';

// Preview/draft builder only. Delivery must be explicitly requested and use
// sendEmail's per-recipient Originals opportunity preference checks.
export function buildOriginalsLaunchEmail({ firstName = 'everyone' } = {}) {
  const base = String(process.env.ADMIN_FRONTEND_URL || 'https://admin.thesupremecollective.co.uk').replace(/\/+$/, '');
  const paragraphs = [
    'Got a song idea, a melody or a groove you’d love to develop with other musicians?',
    'TSC Originals is a new space on your dashboard for creating and releasing original music together — and it’s free to take part.',
    'Start a project. Upload a rough idea or a voice note explaining the vibe. Or simply suggest a genre and leave room for everyone’s creativity.',
    'Invite your favourite colleagues. Bring in musicians from The Supreme Collective or invite people outside TSC to join you.',
    'Join someone else’s project. Find a part you’d enjoy recording and contribute from your own setup.',
    'Projects move through recording rounds towards mixing and mastering, keeping things moving and making the next step clear. Listen to the approved parts, adjust your reference mix, record your contribution and upload it for review.',
    'The project owner keeps creative control over which recordings make the final track. Project chat, feedback and revision requests help everyone develop their ideas together.',
    'Your accepted contribution and agreed royalty share are recorded, with any royalties due through TSC paid twice a year.',
    'TSC will manage and oversee finished releases, pursuing streaming, downloads, publishing and sync opportunities for film, TV, advertising and games. We’ll also explore broadcast income, festivals and original live-performance projects, with tailored social content and promotion for releases we believe can connect with an audience.',
    'We’d love you to help us get the first collaborations underway.',
  ];
  const p = text => `<p style="margin:0 0 18px;font-size:16px;line-height:26px;color:#444444;">${text}</p>`;
  const bodyHtml = [p(paragraphs[0]),p(`<strong>${paragraphs[1]}</strong>`),'<ul style="margin:0 0 22px;padding-left:22px;color:#444444;font-size:16px;line-height:26px;">',...paragraphs.slice(2,5).map(text=>`<li style="margin:0 0 12px;">${text.replace(/^([^.]+\.)/, '<strong>$1</strong>')}</li>`),'</ul>',...paragraphs.slice(5).map((text,index)=>p(index===2?`<strong>${text}</strong>`:text))].join('\n');
  return buildOriginalsEmail({
    subject: 'Introducing TSC Originals — create something together',
    heading: 'Create something original, together',
    firstName, bodyHtml, bodyText: paragraphs.join('\n\n'),
    buttonLabel: 'Explore TSC Originals', buttonUrl: `${base}/originals`,
    afterButton: ['Bring an idea, invite a colleague or try a part. You don’t need a finished song to begin.'],
  });
}
