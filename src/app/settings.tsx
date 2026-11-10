import { Link } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { config } from "../config/config";
import { readModelId, saveModelId } from "../config/modelSetting";
import { useLanguage } from "../i18n/LanguageContext";
import { LANGUAGES } from "../i18n/languages";
import { STRINGS, type Strings } from "../i18n/strings";
import { useApiKey } from "../key/KeyContext";
import {
  readPhotoLookupSave,
  readTextLookupSave,
  savePhotoLookupSave,
  saveTextLookupSave,
} from "../lookup/saveSetting";
import { useQueue } from "../queue/QueueContext";
import { deviceStore } from "../storage/keyValueStore";

type KeyMessage = keyof Pick<
  Strings["settings"]["key"],
  "saved" | "removed" | "empty" | "notSendable" | "saveFailed" | "removeFailed"
>;

type ModelMessage = keyof Pick<
  Strings["settings"]["model"],
  "saved" | "empty" | "invalid" | "saveFailed"
>;

const KEY_REFUSALS: { readonly [R in "empty" | "not-sendable" | "store-failed"]: KeyMessage } = {
  empty: "empty",
  "not-sendable": "notSendable",
  "store-failed": "saveFailed",
};

const MODEL_REFUSALS: { readonly [R in "empty" | "invalid" | "store-failed"]: ModelMessage } = {
  empty: "empty",
  invalid: "invalid",
  "store-failed": "saveFailed",
};

/**
 * The Settings screen (docs/SPEC.md 3.1): the API key (entered, replaced or removed, and never
 * shown once saved), the model, the starting values of the lookups' "Save" switch (3.9), the
 * app's language, and the link to About.
 */
export default function SettingsScreen() {
  const { language, strings, chooseLanguage } = useLanguage();
  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <KeySection />
      <ModelSection />
      <LookupsSection />
      <Text accessibilityRole="header" style={styles.heading}>
        {strings.settings.languageHeading}
      </Text>
      <View accessibilityRole="radiogroup" style={styles.options}>
        {LANGUAGES.map((code) => (
          <Pressable
            key={code}
            accessibilityRole="radio"
            accessibilityState={{ checked: code === language }}
            onPress={() => chooseLanguage(code)}
            style={[styles.option, code === language && styles.chosen]}
          >
            <Text style={styles.optionText}>{STRINGS[code].languageName}</Text>
          </Pressable>
        ))}
      </View>
      <Link href="/about" accessibilityRole="link" style={styles.text}>
        {strings.about.title}
      </Link>
    </ScrollView>
  );
}

function KeySection() {
  const { strings } = useLanguage();
  const t = strings.settings.key;
  const { status, save, remove } = useApiKey();
  const { settingChanged } = useQueue();
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<KeyMessage | null>(null);
  const mounted = useMounted();

  const onSave = async () => {
    const result = await save(draft);
    if (result.ok) {
      settingChanged("key");
    }
    if (!mounted.current) {
      return;
    }
    if (result.ok) {
      setDraft("");
      setMessage("saved");
    } else {
      setMessage(KEY_REFUSALS[result.reason]);
    }
  };

  const onRemove = async () => {
    const result = await remove();
    if (mounted.current) {
      setMessage(result.ok ? "removed" : "removeFailed");
    }
  };

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>
        {t.heading}
      </Text>
      {status === "loading" ? (
        <ActivityIndicator testID="key-loading" />
      ) : (
        <Text style={styles.text}>{t[status]}</Text>
      )}
      <TextInput
        accessibilityLabel={t.input}
        placeholder={t.input}
        value={draft}
        onChangeText={setDraft}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        style={styles.input}
      />
      <Pressable accessibilityRole="button" onPress={onSave} style={styles.button}>
        <Text style={styles.optionText}>{t.save}</Text>
      </Pressable>
      {/* A key store that cannot be read may still hold a key: Remove is offered for it too. */}
      {(status === "stored" || status === "unreadable") && (
        <Pressable accessibilityRole="button" onPress={onRemove} style={styles.button}>
          <Text style={styles.optionText}>{t.remove}</Text>
        </Pressable>
      )}
      {message !== null && (
        <Text accessibilityLiveRegion="polite" style={styles.text}>
          {t[message]}
        </Text>
      )}
    </View>
  );
}

function ModelSection() {
  const { strings } = useLanguage();
  const t = strings.settings.model;
  const { settingChanged } = useQueue();
  const [modelId, setModelId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<ModelMessage | null>(null);
  const mounted = useMounted();

  useEffect(() => {
    readModelId(deviceStore).then((id) => {
      if (mounted.current) {
        setModelId(id);
      }
    });
  }, [mounted]);

  const choose = async (raw: string, fromField: boolean) => {
    const result = await saveModelId(deviceStore, raw);
    if (result.ok) {
      settingChanged("model");
    }
    if (!mounted.current) {
      return;
    }
    if (result.ok) {
      setModelId(result.id);
      setMessage("saved");
      if (fromField) {
        setDraft("");
      }
    } else {
      setMessage(MODEL_REFUSALS[result.reason]);
    }
  };

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>
        {t.heading}
      </Text>
      {modelId === null ? (
        <ActivityIndicator testID="model-loading" />
      ) : (
        <View style={styles.row}>
          <Text style={styles.text}>{t.inUse}</Text>
          <Text testID="model-in-use" style={styles.value}>
            {modelId}
          </Text>
        </View>
      )}
      <View accessibilityRole="radiogroup" style={styles.options}>
        {config.models.map((model) => (
          <Pressable
            key={model.id}
            accessibilityRole="radio"
            accessibilityLabel={model.id}
            accessibilityState={{ checked: model.id === modelId }}
            onPress={() => choose(model.id, false)}
            style={[styles.option, styles.row, model.id === modelId && styles.chosen]}
          >
            <Text style={styles.optionText}>{model.id}</Text>
            {model.id === config.defaultModelId && <Text style={styles.mark}>{t.default}</Text>}
          </Pressable>
        ))}
      </View>
      <TextInput
        accessibilityLabel={t.input}
        placeholder={t.input}
        value={draft}
        onChangeText={setDraft}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
      <Pressable
        accessibilityRole="button"
        onPress={() => choose(draft, true)}
        style={styles.button}
      >
        <Text style={styles.optionText}>{t.save}</Text>
      </Pressable>
      {message !== null && (
        <Text accessibilityLiveRegion="polite" style={styles.text}>
          {t[message]}
        </Text>
      )}
    </View>
  );
}

/** The starting values of the lookups' "Save" switch, as read (null while being read). */
type LookupStarts = { readonly text: boolean; readonly photo: boolean };

/**
 * The starting values of the lookups' "Save" switch (docs/SPEC.md 3.9), the photo lookup's
 * (PBI-2.13) beside the text lookup's: read from the plain store, and saved there when changed. A
 * value that cannot be saved is said so, and the switch keeps the value saved before.
 */
function LookupsSection() {
  const { strings } = useLanguage();
  const t = strings.settings.lookups;
  const [starts, setStarts] = useState<LookupStarts | null>(null);
  const [failed, setFailed] = useState(false);
  const mounted = useMounted();

  useEffect(() => {
    Promise.all([readTextLookupSave(deviceStore), readPhotoLookupSave(deviceStore)]).then(
      ([text, photo]) => {
        if (mounted.current) {
          setStarts({ text, photo });
        }
      },
    );
  }, [mounted]);

  const change = async (lookup: keyof LookupStarts, on: boolean) => {
    const save = lookup === "text" ? saveTextLookupSave : savePhotoLookupSave;
    const result = await save(deviceStore, on);
    if (!mounted.current) {
      return;
    }
    setFailed(!result.ok);
    if (result.ok) {
      setStarts((current) => (current === null ? current : { ...current, [lookup]: on }));
    }
  };

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>
        {t.heading}
      </Text>
      {starts === null ? (
        <ActivityIndicator testID="lookups-loading" />
      ) : (
        <>
          <View style={styles.row}>
            <Switch
              accessibilityLabel={t.photoSave}
              value={starts.photo}
              onValueChange={(on) => void change("photo", on)}
            />
            <Text style={styles.text}>{t.photoSave}</Text>
          </View>
          <View style={styles.row}>
            <Switch
              accessibilityLabel={t.textSave}
              value={starts.text}
              onValueChange={(on) => void change("text", on)}
            />
            <Text style={styles.text}>{t.textSave}</Text>
          </View>
        </>
      )}
      {failed && (
        <Text accessibilityLiveRegion="polite" style={styles.text}>
          {t.saveFailed}
        </Text>
      )}
    </View>
  );
}

/** A ref that is true while the component is mounted, so late answers change nothing. */
function useMounted(): { readonly current: boolean } {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
  },
  section: {
    gap: 8,
    paddingBottom: 12,
  },
  heading: {
    fontSize: 18,
    fontWeight: "bold",
  },
  text: {
    fontSize: 16,
  },
  value: {
    fontSize: 16,
    fontWeight: "bold",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  options: {
    gap: 8,
  },
  option: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
  chosen: {
    borderWidth: 3,
  },
  optionText: {
    fontSize: 16,
  },
  mark: {
    fontSize: 14,
    fontStyle: "italic",
  },
  input: {
    fontSize: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  button: {
    alignSelf: "flex-start",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
});
