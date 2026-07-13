use crate::ipc::StreamEvent;

#[derive(Debug, Clone)]
pub enum Role {
    User,
    Assistant,
    System,
}

#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub role: Role,
    pub content: String,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    #[default]
    Idle,
    Sending,
}

pub struct App {
    pub messages: Vec<ChatMessage>,
    pub session_id: Option<String>,
    pub provider: String,
    pub model: String,
    pub status: Status,
    pub should_quit: bool,
    pub scroll: u16,
    in_progress: Option<usize>,
}

impl App {
    pub fn new() -> Self {
        Self {
            messages: Vec::new(),
            session_id: None,
            provider: String::new(),
            model: String::new(),
            status: Status::Idle,
            should_quit: false,
            scroll: 0,
            in_progress: None,
        }
    }

    pub fn push_user(&mut self, content: String) {
        self.messages.push(ChatMessage {
            role: Role::User,
            content,
        });
    }

    pub fn push_system(&mut self, content: String) {
        self.messages.push(ChatMessage {
            role: Role::System,
            content,
        });
    }

    pub fn begin_assistant_turn(&mut self) {
        self.messages.push(ChatMessage {
            role: Role::Assistant,
            content: String::new(),
        });
        self.in_progress = Some(self.messages.len() - 1);
    }

    pub fn apply_stream_event(&mut self, event: StreamEvent) {
        let Some(idx) = self.in_progress else { return };
        match event {
            StreamEvent::TextDelta { delta } => {
                self.messages[idx].content.push_str(&delta);
            }
            StreamEvent::Text { content } => {
                self.messages[idx].content = content;
            }
            StreamEvent::ToolStart { tool_name, .. } => {
                self.push_system(format!("→ running {tool_name}"));
            }
            StreamEvent::ToolComplete { tool_name, success, .. } => {
                let mark = if success { "done" } else { "failed" };
                self.push_system(format!("← {tool_name} {mark}"));
            }
            StreamEvent::Error { content } => {
                self.push_system(format!("error: {content}"));
                self.status = Status::Idle;
                self.in_progress = None;
            }
            StreamEvent::Done { .. } => {
                self.status = Status::Idle;
                self.in_progress = None;
            }
            _ => {}
        }
    }
}
