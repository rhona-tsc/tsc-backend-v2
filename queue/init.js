// queue/init.ts
import { Queue } from "bullmq";
export const notificationsQ = new Queue("lineup-notifications");