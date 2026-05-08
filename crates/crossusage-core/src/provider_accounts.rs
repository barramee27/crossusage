use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const STORE_FILE: &str = "provider_accounts.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCredential {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
}

impl ProviderCredential {
    pub fn is_empty(&self) -> bool {
        self.access_token.as_deref().unwrap_or("").trim().is_empty()
            && self.refresh_token.as_deref().unwrap_or("").trim().is_empty()
            && self.session_key.as_deref().unwrap_or("").trim().is_empty()
            && self.expires_at.is_none()
    }

    pub fn merge_update(&mut self, update: ProviderCredential) {
        if let Some(value) = update.access_token {
            self.access_token = normalize_secret(value);
        }
        if let Some(value) = update.refresh_token {
            self.refresh_token = normalize_secret(value);
        }
        if let Some(value) = update.session_key {
            self.session_key = normalize_secret(value);
        }
        if update.expires_at.is_some() {
            self.expires_at = update.expires_at;
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAccount {
    pub instance_id: String,
    pub base_provider_id: String,
    pub label: String,
    #[serde(default)]
    pub credential: ProviderCredential,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAccountsStore {
    #[serde(default)]
    pub accounts: BTreeMap<String, ProviderAccount>,
}

#[derive(Debug, Clone)]
pub struct ProviderAccountContext {
    pub instance_id: String,
    pub base_provider_id: String,
    pub label: String,
    pub credential: Option<ProviderCredential>,
    pub store_path: Option<PathBuf>,
}

pub fn store_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(STORE_FILE)
}

pub fn load_store(app_data_dir: &Path) -> io::Result<ProviderAccountsStore> {
    load_store_path(&store_path(app_data_dir))
}

pub fn load_store_path(path: &Path) -> io::Result<ProviderAccountsStore> {
    match fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).map_err(|err| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("invalid provider accounts store: {err}"),
            )
        }),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(ProviderAccountsStore::default()),
        Err(err) => Err(err),
    }
}

pub fn save_store(app_data_dir: &Path, store: &ProviderAccountsStore) -> io::Result<()> {
    save_store_path(&store_path(app_data_dir), store)
}

pub fn save_store_path(path: &Path, store: &ProviderAccountsStore) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(store).map_err(io::Error::other)?;
    fs::write(path, text)
}

pub fn get_account(app_data_dir: &Path, instance_id: &str) -> io::Result<Option<ProviderAccount>> {
    Ok(load_store(app_data_dir)?.accounts.get(instance_id).cloned())
}

pub fn upsert_account(app_data_dir: &Path, mut account: ProviderAccount) -> io::Result<()> {
    account.instance_id = account.instance_id.trim().to_string();
    account.base_provider_id = account.base_provider_id.trim().to_string();
    account.label = account.label.trim().to_string();
    account.credential.access_token = account.credential.access_token.and_then(normalize_secret);
    account.credential.refresh_token = account.credential.refresh_token.and_then(normalize_secret);
    account.credential.session_key = account.credential.session_key.and_then(normalize_secret);

    let mut store = load_store(app_data_dir)?;
    store.accounts.insert(account.instance_id.clone(), account);
    save_store(app_data_dir, &store)
}

pub fn delete_account(app_data_dir: &Path, instance_id: &str) -> io::Result<()> {
    let mut store = load_store(app_data_dir)?;
    store.accounts.remove(instance_id);
    save_store(app_data_dir, &store)
}

pub fn update_credential_at_path(
    store_path: &Path,
    instance_id: &str,
    update: ProviderCredential,
) -> io::Result<Option<ProviderCredential>> {
    let mut store = load_store_path(store_path)?;
    let Some(account) = store.accounts.get_mut(instance_id) else {
        return Ok(None);
    };
    account.credential.merge_update(update);
    let credential = account.credential.clone();
    save_store_path(store_path, &store)?;
    Ok(Some(credential))
}

fn normalize_secret(value: String) -> Option<String> {
    let trimmed = value.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("crossusage-provider-accounts-{name}-{nonce}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn upsert_load_and_update_credentials() {
        let dir = temp_dir("roundtrip");
        upsert_account(
            &dir,
            ProviderAccount {
                instance_id: "claude:work".into(),
                base_provider_id: "claude".into(),
                label: "Work".into(),
                credential: ProviderCredential {
                    access_token: Some("old".into()),
                    refresh_token: None,
                    session_key: None,
                    expires_at: None,
                },
            },
        )
        .unwrap();

        let path = store_path(&dir);
        let updated = update_credential_at_path(
            &path,
            "claude:work",
            ProviderCredential {
                access_token: Some("new".into()),
                refresh_token: Some("refresh".into()),
                session_key: None,
                expires_at: Some(123),
            },
        )
        .unwrap()
        .unwrap();

        assert_eq!(updated.access_token.as_deref(), Some("new"));
        assert_eq!(updated.refresh_token.as_deref(), Some("refresh"));
        assert_eq!(updated.expires_at, Some(123));
        assert_eq!(
            get_account(&dir, "claude:work")
                .unwrap()
                .unwrap()
                .credential
                .access_token
                .as_deref(),
            Some("new")
        );
        let _ = fs::remove_dir_all(dir);
    }
}
