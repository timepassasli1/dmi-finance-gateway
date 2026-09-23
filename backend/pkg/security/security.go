package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// HashPassword hashes a password using bcrypt.
func HashPassword(password string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// CheckPassword verifies a bcrypt hash.
func CheckPassword(password, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// GenerateSecureToken generates a cryptographically random hex token.
func GenerateSecureToken(prefix string) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return prefix + hex.EncodeToString(b), nil
}

// HMACSign creates an HMAC-SHA256 signature.
func HMACSign(secret, payload string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}

// HMACVerify verifies an HMAC-SHA256 signature.
func HMACVerify(secret, payload, sig string) bool {
	expected := HMACSign(secret, payload)
	return hmac.Equal([]byte(expected), []byte(sig))
}

// WebhookSignature generates an HMAC signature for webhook payloads.
func WebhookSignature(secret string, timestamp int64, body []byte) string {
	payload := fmt.Sprintf("%d.%s", timestamp, string(body))
	return HMACSign(secret, payload)
}

// resolveAESKey accepts a 64-char hex string OR a 16/24/32-byte ASCII string.
func resolveAESKey(k string) ([]byte, error) {
	if len(k) == 32 || len(k) == 24 || len(k) == 16 {
		return []byte(k), nil
	}
	key, err := hex.DecodeString(k)
	if err != nil || len(key) != 32 {
		return nil, fmt.Errorf("invalid encryption key (need 32-byte ASCII or 64-char hex)")
	}
	return key, nil
}

// EncryptAES256GCM encrypts data using AES-256-GCM.
func EncryptAES256GCM(keyHex string, plaintext string) (string, error) {
	key, err := resolveAESKey(keyHex)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ct := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ct), nil
}

// DecryptAES256GCM decrypts AES-256-GCM ciphertext.
func DecryptAES256GCM(keyHex string, ciphertextB64 string) (string, error) {
	key, err := resolveAESKey(keyHex)
	if err != nil {
		return "", err
	}
	ct, err := base64.StdEncoding.DecodeString(ciphertextB64)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(ct) < gcm.NonceSize() {
		return "", fmt.Errorf("ciphertext too short")
	}
	nonce, ct := ct[:gcm.NonceSize()], ct[gcm.NonceSize():]
	pt, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", err
	}
	return string(pt), nil
}

// MaskSecret masks a secret for display (shows prefix + last 4 chars).
func MaskSecret(secret string) string {
	if len(secret) <= 8 {
		return strings.Repeat("*", len(secret))
	}
	parts := strings.SplitN(secret, "_", 3)
	if len(parts) >= 3 {
		prefix := parts[0] + "_" + parts[1] + "_"
		return prefix + strings.Repeat("*", len(secret)-len(prefix)-4) + secret[len(secret)-4:]
	}
	return secret[:4] + strings.Repeat("*", len(secret)-8) + secret[len(secret)-4:]
}

// GenerateRequestID generates a unique request ID.
func GenerateRequestID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return "REQ_" + strings.ToUpper(hex.EncodeToString(b))
}

// TimestampValid checks if a timestamp is within acceptable range (5 minutes).
func TimestampValid(ts int64) bool {
	diff := time.Now().Unix() - ts
	if diff < 0 {
		diff = -diff
	}
	return diff < 300
}
