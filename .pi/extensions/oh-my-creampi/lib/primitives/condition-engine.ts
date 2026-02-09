type ConditionLiteral = string | number | boolean | null;

type ConditionNode =
	| { type: "literal"; value: ConditionLiteral }
	| { type: "identifier"; path: string }
	| { type: "unary"; operator: "!"; argument: ConditionNode }
	| {
			type: "binary";
			operator: "&&" | "||" | "==" | "!=" | ">" | ">=" | "<" | "<=";
			left: ConditionNode;
			right: ConditionNode;
	  };

type OperatorTokenValue = "!" | "&&" | "||" | "==" | "!=" | ">" | ">=" | "<" | "<=";
type ComparisonOperator = "==" | "!=" | ">" | ">=" | "<" | "<=";

type Token =
	| { type: "paren"; value: "(" | ")"; index: number }
	| { type: "operator"; value: OperatorTokenValue; index: number }
	| { type: "literal"; value: ConditionLiteral; index: number }
	| { type: "identifier"; value: string; index: number }
	| { type: "eof"; index: number };

export type ConditionValidationResult = {
	valid: boolean;
	errors: string[];
};

export type ConditionEvaluationResult = {
	passed: boolean;
	reason: string;
};

function tokenize(expression: string): Token[] {
	const tokens: Token[] = [];
	let cursor = 0;

	const readString = (quote: "'" | '"'): string => {
		cursor += 1;
		let output = "";
		while (cursor < expression.length) {
			const char = expression[cursor] ?? "";
			if (char === quote) {
				cursor += 1;
				return output;
			}
			if (char === "\\") {
				const next = expression[cursor + 1] ?? "";
				output += next;
				cursor += 2;
				continue;
			}
			output += char;
			cursor += 1;
		}
		throw new Error("unterminated string literal");
	};

	while (cursor < expression.length) {
		const char = expression[cursor] ?? "";
		if (/\s/.test(char)) {
			cursor += 1;
			continue;
		}

		const start = cursor;
		const twoChar = expression.slice(cursor, cursor + 2);
		if (["&&", "||", "==", "!=", ">=", "<="].includes(twoChar)) {
			tokens.push({ type: "operator", value: twoChar as OperatorTokenValue, index: start });
			cursor += 2;
			continue;
		}
		if (char === "!" || char === ">" || char === "<") {
			tokens.push({ type: "operator", value: char as OperatorTokenValue, index: start });
			cursor += 1;
			continue;
		}
		if (char === "(" || char === ")") {
			tokens.push({ type: "paren", value: char, index: start });
			cursor += 1;
			continue;
		}
		if (char === "'" || char === '"') {
			tokens.push({ type: "literal", value: readString(char), index: start });
			continue;
		}
		if (/[-0-9]/.test(char)) {
			const tail = expression.slice(cursor);
			const match = /^-?\d+(?:\.\d+)?/.exec(tail);
			if (!match) throw new Error(`invalid number at ${start}`);
			const value = Number(match[0]);
			tokens.push({ type: "literal", value, index: start });
			cursor += match[0].length;
			continue;
		}
		if (/[A-Za-z_]/.test(char)) {
			const tail = expression.slice(cursor);
			const match = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(tail);
			if (!match) throw new Error(`invalid identifier at ${start}`);
			const value = match[0];
			if (value === "true") tokens.push({ type: "literal", value: true, index: start });
			else if (value === "false") tokens.push({ type: "literal", value: false, index: start });
			else if (value === "null") tokens.push({ type: "literal", value: null, index: start });
			else tokens.push({ type: "identifier", value, index: start });
			cursor += value.length;
			continue;
		}

		throw new Error(`unexpected token '${char}' at ${start}`);
	}

	tokens.push({ type: "eof", index: cursor });
	return tokens;
}

class Parser {
	private cursor = 0;

	constructor(private readonly tokens: Token[]) {}

	parse(): ConditionNode {
		const node = this.parseOr();
		if (this.current().type !== "eof") {
			throw new Error(`unexpected token at ${this.current().index}`);
		}
		return node;
	}

	private parseOr(): ConditionNode {
		let node = this.parseAnd();
		while (this.matchOperator("||")) {
			node = { type: "binary", operator: "||", left: node, right: this.parseAnd() };
		}
		return node;
	}

	private parseAnd(): ConditionNode {
		let node = this.parseCompare();
		while (this.matchOperator("&&")) {
			node = { type: "binary", operator: "&&", left: node, right: this.parseCompare() };
		}
		return node;
	}

	private parseCompare(): ConditionNode {
		let node = this.parseUnary();
		while (true) {
			const op = this.matchComparisonOperator();
			if (!op) break;
			node = { type: "binary", operator: op, left: node, right: this.parseUnary() };
		}
		return node;
	}

	private parseUnary(): ConditionNode {
		if (this.matchOperator("!")) {
			return { type: "unary", operator: "!", argument: this.parseUnary() };
		}
		return this.parsePrimary();
	}

	private parsePrimary(): ConditionNode {
		const token = this.current();
		if (token.type === "literal") {
			this.cursor += 1;
			return { type: "literal", value: token.value };
		}
		if (token.type === "identifier") {
			this.cursor += 1;
			return { type: "identifier", path: token.value };
		}
		if (token.type === "paren" && token.value === "(") {
			this.cursor += 1;
			const node = this.parseOr();
			const close = this.current();
			if (close.type !== "paren" || close.value !== ")") {
				throw new Error(`missing closing parenthesis near ${close.index}`);
			}
			this.cursor += 1;
			return node;
		}
		throw new Error(`unexpected token at ${token.index}`);
	}

	private current(): Token {
		return this.tokens[Math.min(this.cursor, this.tokens.length - 1)] as Token;
	}

	private matchComparisonOperator(): ComparisonOperator | undefined {
		const token = this.current();
		if (token.type !== "operator") return undefined;
		if (
			token.value !== "==" &&
			token.value !== "!=" &&
			token.value !== ">" &&
			token.value !== ">=" &&
			token.value !== "<" &&
			token.value !== "<="
		) {
			return undefined;
		}
		this.cursor += 1;
		return token.value;
	}

	private matchOperator(...ops: OperatorTokenValue[]): OperatorTokenValue | undefined {
		const token = this.current();
		if (token.type !== "operator") return undefined;
		if (!ops.includes(token.value)) return undefined;
		this.cursor += 1;
		return token.value;
	}
}

function resolvePath(context: Record<string, unknown>, path: string): unknown {
	return path.split(".").reduce<unknown>((cursor, part) => {
		if (!cursor || typeof cursor !== "object") return undefined;
		return (cursor as Record<string, unknown>)[part];
	}, context);
}

function compare(operator: "==" | "!=" | ">" | ">=" | "<" | "<=", left: unknown, right: unknown): boolean {
	if (operator === "==") return Object.is(left, right);
	if (operator === "!=") return !Object.is(left, right);
	if ((typeof left !== "number" || typeof right !== "number") && (typeof left !== "string" || typeof right !== "string")) {
		return false;
	}
	if (operator === ">") return (left as number | string) > (right as number | string);
	if (operator === ">=") return (left as number | string) >= (right as number | string);
	if (operator === "<") return (left as number | string) < (right as number | string);
	return (left as number | string) <= (right as number | string);
}

function evalNode(node: ConditionNode, context: Record<string, unknown>): unknown {
	if (node.type === "literal") return node.value;
	if (node.type === "identifier") return resolvePath(context, node.path);
	if (node.type === "unary") return !Boolean(evalNode(node.argument, context));

	if (node.operator === "&&") {
		return Boolean(evalNode(node.left, context)) && Boolean(evalNode(node.right, context));
	}
	if (node.operator === "||") {
		return Boolean(evalNode(node.left, context)) || Boolean(evalNode(node.right, context));
	}

	const left = evalNode(node.left, context);
	const right = evalNode(node.right, context);
	return compare(node.operator, left, right);
}

export class ConditionEngine {
	parse(expression: string): ConditionNode {
		const normalized = expression.trim();
		if (!normalized) throw new Error("condition expression is empty");
		const tokens = tokenize(normalized);
		const parser = new Parser(tokens);
		return parser.parse();
	}

	validate(expression: string): ConditionValidationResult {
		try {
			this.parse(expression);
			return { valid: true, errors: [] };
		} catch (error) {
			return { valid: false, errors: [error instanceof Error ? error.message : String(error)] };
		}
	}

	evaluate(expression: string, context: Record<string, unknown>): ConditionEvaluationResult {
		try {
			const ast = this.parse(expression);
			const passed = Boolean(evalNode(ast, context));
			return {
				passed,
				reason: passed ? "condition passed" : "condition evaluated to false",
			};
		} catch (error) {
			return {
				passed: false,
				reason: error instanceof Error ? error.message : String(error),
			};
		}
	}
}
