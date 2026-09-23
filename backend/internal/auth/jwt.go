package auth

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type JWTManager struct {
	secret    string
	accessTTL time.Duration
}

type jwtClaims struct {
	jwt.RegisteredClaims
	UserID   string `json:"uid"`
	Role     string `json:"role"`
	ClientID string `json:"cid,omitempty"`
}

func NewJWTManager(secret string, accessTTL time.Duration) *JWTManager {
	return &JWTManager{secret: secret, accessTTL: accessTTL}
}

func (j *JWTManager) Generate(userID, role, clientID string) (string, error) {
	claims := jwtClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(j.accessTTL)),
			Issuer:    "gateway",
		},
		UserID:   userID,
		Role:     role,
		ClientID: clientID,
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(j.secret))
}

func (j *JWTManager) Verify(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &jwtClaims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return []byte(j.secret), nil
	})
	if err != nil {
		return nil, fmt.Errorf("invalid token: %w", err)
	}
	claims, ok := token.Claims.(*jwtClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token claims")
	}
	return &Claims{
		UserID:   claims.UserID,
		Role:     claims.Role,
		ClientID: claims.ClientID,
	}, nil
}
