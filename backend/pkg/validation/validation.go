package validation

import (
	"fmt"
	"regexp"
	"strings"
)

var (
	emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)
	phoneRegex = regexp.MustCompile(`^\+?[0-9]{10,15}$`)
	upiRegex   = regexp.MustCompile(`^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$`)
)

func ValidateEmail(email string) error {
	if !emailRegex.MatchString(email) {
		return fmt.Errorf("invalid email address")
	}
	return nil
}

func ValidatePhone(phone string) error {
	clean := strings.ReplaceAll(phone, " ", "")
	if !phoneRegex.MatchString(clean) {
		return fmt.Errorf("invalid phone number")
	}
	return nil
}

func ValidateUPIID(upiID string) error {
	if !upiRegex.MatchString(upiID) {
		return fmt.Errorf("invalid UPI ID format")
	}
	return nil
}

func ValidateAmount(amount int64) error {
	if amount <= 0 {
		return fmt.Errorf("amount must be positive")
	}
	if amount > 10_00_00000 { // 10 lakh in paise
		return fmt.Errorf("amount exceeds maximum allowed")
	}
	return nil
}

func ValidateCurrency(currency string) error {
	supported := map[string]bool{"INR": true}
	if !supported[strings.ToUpper(currency)] {
		return fmt.Errorf("unsupported currency: %s", currency)
	}
	return nil
}

func SanitizeString(s string) string {
	return strings.TrimSpace(s)
}
