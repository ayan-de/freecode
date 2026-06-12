import { useState, useEffect, useCallback, useRef } from "react";
import {
  listProviders,
  listModels,
  getCurrentModel,
  setCurrentModel,
  getApiKeyStatus,
  setApiKey as setBackendApiKey,
  type ProviderInfo,
  type ModelInfo,
} from "../ipc-stub";

export interface FreeCodeConfigState {
  providers: ProviderInfo[];
  models: ModelInfo[];
  selectedProvider: string;
  selectedModel: string;
  apiKeysStatus: Record<string, boolean>;
  isLoading: boolean;
  error: string | null;

  changeModel: (providerId: string, modelId: string) => Promise<void>;
  saveApiKey: (
    providerId: string,
    apiKey: string,
    modelId?: string,
  ) => Promise<void>;
  refreshConfig: () => Promise<void>;
}

export function useFreeCodeConfig(): FreeCodeConfigState {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [apiKeysStatus, setApiKeysStatus] = useState<Record<string, boolean>>(
    {},
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isInitialLoad = useRef(true);

  const loadConfigData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const providerList = await listProviders();
      setProviders(providerList);

      const keyStatus = await getApiKeyStatus().catch(() => ({}));
      setApiKeysStatus(keyStatus);

      const current = await getCurrentModel().catch(() => null);

      if (current && current.provider && current.model) {
        setSelectedProvider(current.provider);
        const modelList = await listModels(current.provider).catch(() => []);
        setModels(modelList);
        if (modelList.some((m) => m.id === current.model)) {
          setSelectedModel(current.model);
        } else if (modelList.length > 0) {
          setSelectedModel(modelList[0].id);
        } else {
          setSelectedModel("");
        }
      } else if (providerList.length > 0) {
        const defaultProvider = providerList[0].id;
        setSelectedProvider(defaultProvider);
        const modelList = await listModels(defaultProvider).catch(() => []);
        setModels(modelList);
        if (modelList.length > 0) {
          setSelectedModel(modelList[0].id);
        } else {
          setSelectedModel("");
        }
      }
    } catch (err: any) {
      console.error("Failed to load FreeCode configuration:", err);
      setError(err.message || "Failed to load configuration");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load config on mount
  useEffect(() => {
    loadConfigData();
  }, [loadConfigData]);

  // Load models when provider changes (except on initial load to prevent races)
  useEffect(() => {
    if (!selectedProvider) return;

    if (isInitialLoad.current) {
      isInitialLoad.current = false;
      return;
    }

    listModels(selectedProvider)
      .then((list) => {
        setModels(list);
        if (list.length > 0) {
          setSelectedModel(list[0].id);
          setCurrentModel(selectedProvider, list[0].id).catch(console.error);
        } else {
          setSelectedModel("");
        }
      })
      .catch((err) => {
        console.error("Failed to load models on provider switch:", err);
        setModels([]);
        setSelectedModel("");
      });
  }, [selectedProvider]);

  const changeModel = useCallback(
    async (providerId: string, modelId: string) => {
      try {
        setError(null);
        setSelectedProvider(providerId);
        setSelectedModel(modelId);

        if (providerId !== selectedProvider) {
          const list = await listModels(providerId).catch(() => []);
          setModels(list);
        }

        await setCurrentModel(providerId, modelId);
      } catch (err: any) {
        console.error("Failed to update active model configuration:", err);
        setError(err.message || "Failed to update model");
      }
    },
    [selectedProvider],
  );

  const saveApiKey = useCallback(
    async (providerId: string, apiKey: string, modelId?: string) => {
      try {
        setError(null);
        await setBackendApiKey(providerId, apiKey, modelId);
        const keyStatus = await getApiKeyStatus().catch(() => ({}));
        setApiKeysStatus(keyStatus);
      } catch (err: any) {
        console.error("Failed to save API Key:", err);
        setError(err.message || "Failed to save API Key");
      }
    },
    [],
  );

  return {
    providers,
    models,
    selectedProvider,
    selectedModel,
    apiKeysStatus,
    isLoading,
    error,
    changeModel,
    saveApiKey,
    refreshConfig: loadConfigData,
  };
}
