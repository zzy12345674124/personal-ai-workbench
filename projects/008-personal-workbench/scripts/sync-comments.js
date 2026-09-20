import { syncCommentSources } from '../server/comment-store.js';

const result = syncCommentSources();
console.log(JSON.stringify(result));
