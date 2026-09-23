package payment_providers

import (
	"fmt"
	"sync"
)

// Registry holds all registered payment providers.
type Registry struct {
	mu        sync.RWMutex
	providers map[string]PaymentProvider
}

func NewRegistry() *Registry {
	return &Registry{providers: make(map[string]PaymentProvider)}
}

func (r *Registry) Register(provider PaymentProvider) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.providers[provider.Name()] = provider
}

func (r *Registry) Get(name string) (PaymentProvider, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	p, ok := r.providers[name]
	if !ok {
		return nil, fmt.Errorf("provider %q not found", name)
	}
	return p, nil
}

func (r *Registry) List() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	names := make([]string, 0, len(r.providers))
	for n := range r.providers {
		names = append(names, n)
	}
	return names
}
