//! The seam through which tests interrupt the backend after any step.

use std::io;
use std::sync::Mutex;

/// What happens at the chosen step.
#[derive(Clone, Copy, Debug)]
pub(crate) enum Action {
    /// The step returns an error, and the backend handles it.
    Fail,
    /// The operation stops at once, as if the process died; nothing after it
    /// runs, including error handling.
    Crash,
}

type Hook = Box<dyn FnMut() + Send>;

#[derive(Default)]
struct State {
    trace: Vec<&'static str>,
    trigger: Option<(usize, Action)>,
    hooks: Vec<(&'static str, Hook)>,
}

/// Records the steps an operation reaches, and can fail or stop it at the
/// `n`th one or run a hook when it reaches a named step.
#[derive(Default)]
pub(crate) struct Faults {
    state: Mutex<State>,
}

impl Faults {
    pub fn hit(&self, name: &'static str) -> io::Result<()> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.trace.push(name);
        let reached = state.trace.len();
        for (step, hook) in &mut state.hooks {
            if *step == name {
                hook();
            }
        }
        match state.trigger {
            Some((at, action)) if at == reached => {
                state.trigger = None;
                drop(state);
                match action {
                    Action::Fail => Err(io::Error::other("injected failure")),
                    // Unwinding skips the panic hook, so the test output
                    // stays quiet.
                    Action::Crash => std::panic::resume_unwind(Box::new("injected crash")),
                }
            }
            _ => Ok(()),
        }
    }

    /// Starts counting steps from zero and triggers `action` at step `at`,
    /// counted from 1.
    pub fn arm(&self, at: usize, action: Action) {
        let mut state = self.state.lock().unwrap();
        state.trace.clear();
        state.trigger = Some((at, action));
    }

    /// Starts recording steps from zero without triggering anything.
    pub fn record(&self) {
        let mut state = self.state.lock().unwrap();
        state.trace.clear();
        state.trigger = None;
    }

    pub fn trace(&self) -> Vec<&'static str> {
        self.state.lock().unwrap().trace.clone()
    }

    pub fn hook(&self, step: &'static str, hook: impl FnMut() + Send + 'static) {
        self.state
            .lock()
            .unwrap()
            .hooks
            .push((step, Box::new(hook)));
    }

    pub fn clear_hooks(&self) {
        self.state.lock().unwrap().hooks.clear();
    }
}
