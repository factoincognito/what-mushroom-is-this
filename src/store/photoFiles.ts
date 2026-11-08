import { Directory, File, Paths } from "expo-file-system";

import { corrupt, invalid } from "./find";

/**
 * The directory of the finds' photos, which only the store writes to. A photo is named by the
 * store; the database keeps only the name, since the app's document directory can move (on iOS
 * it does when the app is updated).
 */
export interface PhotoFiles {
  /** Makes the directory if it is not there. */
  prepare(): void;
  /** Copies the photo at `sourceUri` in as `baseName` plus the source's extension; gives the name. */
  copyIn(sourceUri: string, baseName: string): Promise<string>;
  /** Removes a photo; one that is not there is no error. */
  remove(name: string): void;
  /** The names of the files in the directory. */
  list(): string[];
  uriOf(name: string): string;
}

const BASE_NAME = /^[A-Za-z0-9-]+$/;
const EXTENSION = /^\.[A-Za-z0-9]{1,8}$/;
const PHOTO_NAME = /^[A-Za-z0-9-]+\.[A-Za-z0-9]{1,8}$/;

/** The photo directory `directoryName` in the app's document directory. */
export function devicePhotoFiles(directoryName: string): PhotoFiles {
  const directory = () => new Directory(Paths.document, directoryName);
  const photo = (name: string) => {
    if (!PHOTO_NAME.test(name)) {
      throw corrupt(`"${name}" is not the name of a photo the store wrote`);
    }
    return new File(directory(), name);
  };

  return {
    prepare() {
      directory().create({ intermediates: true, idempotent: true });
    },

    async copyIn(sourceUri, baseName) {
      if (!BASE_NAME.test(baseName)) {
        throw invalid(`"${baseName}" is not a plain file name`);
      }
      const source = new File(sourceUri);
      const extension = source.extension;
      if (!EXTENSION.test(extension)) {
        throw invalid("the photo's file name has no extension of letters and digits");
      }
      if (!source.exists) {
        throw invalid("the photo's file does not exist");
      }
      const name = `${baseName}${extension}`;
      await source.copy(new File(directory(), name));
      return name;
    },

    remove(name) {
      const file = photo(name);
      if (file.exists) {
        file.delete();
      }
    },

    list() {
      return directory()
        .list()
        .filter((entry) => entry instanceof File)
        .map((file) => file.name);
    },

    uriOf(name) {
      return photo(name).uri;
    },
  };
}
