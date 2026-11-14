//! Подпись меток (com.atproto.label.defs#label): DAG-CBOR метки без `sig` → SHA-256 → secp256k1, low-S, 64 байта.
//! Ключ коллегии — в DID-документе как Multikey (`publicKeyMultibase`, z + base58btc(0xe7 0x01 + сжатый ключ)).

use std::collections::BTreeMap;

use ipld_core::ipld::Ipld;
use k256::ecdsa::{Signature, SigningKey, VerifyingKey, signature::hazmat::PrehashSigner};
use sha2::{Digest, Sha256};

/// метка до подписи; поля и их наличие — ровно как в лексиконе (необязательные пустые не пишем)
#[derive(Clone, Debug, PartialEq)]
pub struct Unsigned {
    pub src: String,
    pub uri: String,
    pub cid: Option<String>,
    pub val: String,
    pub neg: bool,
    pub cts: String,
}

impl Unsigned {
    /// map в каноническом порядке DAG-CBOR делает сериализатор; здесь — только набор полей
    pub fn to_ipld(&self) -> Ipld {
        let mut m = BTreeMap::new();
        m.insert("ver".to_string(), Ipld::Integer(1));
        m.insert("src".to_string(), Ipld::String(self.src.clone()));
        m.insert("uri".to_string(), Ipld::String(self.uri.clone()));
        if let Some(cid) = &self.cid {
            m.insert("cid".to_string(), Ipld::String(cid.clone()));
        }
        m.insert("val".to_string(), Ipld::String(self.val.clone()));
        if self.neg {
            m.insert("neg".to_string(), Ipld::Bool(true));
        }
        m.insert("cts".to_string(), Ipld::String(self.cts.clone()));
        Ipld::Map(m)
    }

    pub fn bytes(&self) -> Vec<u8> {
        serde_ipld_dagcbor::to_vec(&self.to_ipld()).expect("dag-cbor")
    }
}

pub fn sign(key: &SigningKey, label: &Unsigned) -> [u8; 64] {
    let digest = Sha256::digest(label.bytes());
    let sig: Signature = key.sign_prehash(&digest).expect("sign");
    // AT Protocol принимает только low-S
    let sig = sig.normalize_s().unwrap_or(sig);
    sig.to_bytes().into()
}

/// Multikey для DID-документа: z + base58btc(varint 0xe7 (secp256k1-pub) + сжатый ключ 33 байта)
pub fn multikey(key: &VerifyingKey) -> String {
    let mut buf = vec![0xe7, 0x01];
    buf.extend_from_slice(key.to_encoded_point(true).as_bytes());
    format!("z{}", bs58::encode(buf).into_string())
}

pub fn key_from_hex(hex_key: &str) -> Result<SigningKey, String> {
    let raw = hex::decode(hex_key.trim()).map_err(|e| format!("hex: {e}"))?;
    SigningKey::from_slice(&raw).map_err(|e| format!("secp256k1: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use k256::ecdsa::signature::hazmat::PrehashVerifier;

    fn label() -> Unsigned {
        Unsigned {
            src: "did:web:tech.justice.weat.media".into(),
            uri: "at://did:plc:abc/media.weat.article/3k".into(),
            cid: None,
            val: "verdict.broken-code".into(),
            neg: false,
            cts: "2026-11-14T10:00:00.000Z".into(),
        }
    }

    #[test]
    fn signature_verifies_and_is_low_s() {
        let key = key_from_hex(&"11".repeat(32)).unwrap();
        let l = label();
        let sig = sign(&key, &l);
        let s = Signature::from_slice(&sig).unwrap();
        assert!(s.normalize_s().is_none(), "low-S");
        let digest = Sha256::digest(l.bytes());
        key.verifying_key().verify_prehash(&digest, &s).unwrap();
    }

    #[test]
    fn dag_cbor_keys_are_canonical_and_optional_fields_omitted() {
        let bytes = label().bytes();
        // map из 5 полей (cid и neg пропущены); канонический порядок DAG-CBOR: короче — раньше, затем по байтам
        assert_eq!(bytes[0], 0xa5);
        let text = String::from_utf8_lossy(&bytes);
        let order: Vec<usize> = ["cts", "src", "uri", "val", "ver"].iter().map(|k| text.find(k).unwrap()).collect();
        assert!(order.windows(2).all(|w| w[0] < w[1]), "{order:?}");
        assert!(!text.contains("neg"));
    }

    #[test]
    fn multikey_prefix() {
        let key = key_from_hex(&"11".repeat(32)).unwrap();
        let mk = multikey(key.verifying_key());
        assert!(mk.starts_with("zQ3s"), "{mk}");
    }
}
