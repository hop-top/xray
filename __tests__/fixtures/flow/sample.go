// Flow fixture: realistic control flow for the structural invariants.
package sample

import (
	"errors"
	"fmt"
	"os"
	"sync"
)

type Server struct {
	mu    sync.Mutex
	conns map[string]chan []byte
	quit  chan struct{}
}

func (s *Server) Serve(addr string) (n int, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("serve %s: %v", addr, r)
		}
	}()
	for id, c := range s.conns {
		select {
		case msg, ok := <-c:
			if !ok {
				delete(s.conns, id)
				continue
			}
			n += len(msg)
		case <-s.quit:
			return n, errors.New("quit")
		default:
			if n > 1<<20 {
				panic("overflow")
			}
		}
	}
	return n, nil
}

func Classify(v interface{}) string {
	switch x := v.(type) {
	case nil:
		return "nil"
	case int, int64:
		if x == 0 {
			return "zero"
		}
		fallthrough
	case uint:
		return "number"
	case error:
		return x.Error()
	default:
		return fmt.Sprint(x)
	}
}

func Parse(lines []string) (map[string]int, error) {
	out := make(map[string]int, len(lines))
	i := 0
next:
	if i >= len(lines) {
		goto done
	}
	for _, f := range split(lines[i]) {
		if f == "" {
			i++
			goto next
		}
		k, v, ok := cut(f)
		if !ok {
			return nil, fmt.Errorf("line %d: bad field %q", i, f)
		}
		out[k] += v
	}
	i++
	goto next
done:
	return out, nil
}

func Spin(work chan func(), stop <-chan struct{}) {
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for {
				select {
				case fn := <-work:
					fn()
				case <-stop:
					return
				}
			}
		}(i)
	}
	wg.Wait()
}

func Walk(grid [][]int) (sum int) {
rows:
	for y, row := range grid {
		for x := range row {
			switch {
			case grid[y][x] < 0:
				continue rows
			case grid[y][x] == 0:
				break rows
			}
			sum += grid[y][x]
		}
	}
	if sum > 100 {
		sum = 100
	} else if sum < 0 {
		sum = 0
	}
	return
}

func Open(path string) (*os.File, error) {
	f, err := os.Open(path)
	if err != nil && !os.IsNotExist(err) || path == "" {
		return nil, err
	}
	return f, nil
}
