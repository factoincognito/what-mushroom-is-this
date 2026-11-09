import { analysePhoto } from "../analysis/analyse";
import { config } from "../config/config";
import { readModelId } from "../config/modelSetting";
import { deviceJpegEncoder } from "../image/deviceJpegEncoder";
import { preparePhotoForAnalysis } from "../image/prepareForAnalysis";
import { deviceStore } from "../storage/keyValueStore";
import { AnalysisQueue, type QueueDeps } from "./queue";

/**
 * The queue on the phone: the model setting in the plain store, the photo prepared at analysis
 * time with the phone's encoder for the model in use, the platform fetch, and the API address and
 * time limit of the config module.
 */
export function createDeviceQueue(parts: Pick<QueueDeps, "findLog" | "readKey">): AnalysisQueue {
  return new AnalysisQueue(
    {
      ...parts,
      readModelId: () => readModelId(deviceStore),
      preparePhoto: (photoUri, modelId) =>
        preparePhotoForAnalysis(photoUri, modelId, deviceJpegEncoder),
      analyse: (input) => analysePhoto(input),
      now: () => Date.now(),
      schedule: (task, delayMs) => {
        const timer = setTimeout(task, delayMs);
        return () => clearTimeout(timer);
      },
    },
    { apiAddress: config.apiBaseUrl, timeLimitMs: config.requestTimeoutMs },
  );
}
