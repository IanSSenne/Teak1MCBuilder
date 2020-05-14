const fs = require("fs");
const path = require("path");
if (process.argv[2]) {
    if (["java", "bedrock"].includes(process.argv[2])) {

        const gaf = require("get-all-files");
        if (!process.argv[3]) {
            console.log("missing path");
            process.exit(1);
        }
        const actual = path.resolve(process.argv[3]);
        console.log(actual);
        gaf(actual).then(files => {
            const functions = {};
            files.filter(filepath => filepath.endsWith(".mcfunction")).map(_ => ({ relative: path.relative(actual, _), absolute: _ })).forEach(_ => {
                console.log(_);
                let file, func, rest;
                if (process.argv[2] === "java") {
                    [file, func, ...rest] = _.relative.replace(".mcfunction", "").split("\\");

                    if (func != "functions") {
                        return;
                    }
                    functions[file] = functions[file] || [];
                    functions[file].push({
                        name: rest.join("/"),
                        content: fs.readFileSync(_.absolute, "utf8").split("\n").map(_ => "\t" + _).join("\n")
                    });
                }
                if (process.argv[2] === "bedrock") {
                    [file, ...rest] = _.relative.replace(".mcfunction", "").split("\\");
                    if (rest.length == 0) {
                        rest = [file];
                        file = "bedrock_root";
                    }
                    functions[file] = functions[file] || [];
                    functions[file].push({
                        name: rest.join("/"),
                        content: fs.readFileSync(_.absolute, "utf8").split("\n").map(_ => "\t" + _).join("\n")
                    });
                }
            });
            fs.mkdirSync("./src", { recursive: true });
            // console.log(functions);
            for (const file in functions) {
                fs.writeFileSync("./src/" + file + ".mc", functions[file].map(_ => {
                    return `function ${_.name}{\n${_.content}\n}`
                }).join("\n\n"));
            }
        }).finally(() => console.log("done"));
    } else {
        console.log("version not specified, expected either 'java' or 'bedrock'")
    }

} else {
    let buildid = 0;
    if (!fs.existsSync("./src")) {
        log("did not find src folder in directory");
        process.exit(1);
    }
    const watch = require("watch");
    function getTimeString() {
        return "[" + new Date().toTimeString().substr(0, 8) + "." + (new Date().getTime() % 1000).toString().padStart(3, '0') + "]";

    }
    function log(...stuff) {
        process.stdout.write("\n" + getTimeString() + " " + stuff.join(" "));
    }
    //fs.existsSync("./.mcproject") ? JSON.parse(fs.readFileSync("./.mcproject", "utf8")) : [];
    const run = () => {
        let THISWRITE = [];

        const packFuncs = { load: [], tick: [] };
        const files = fs.readdirSync("./src");
        let functions = {};
        let name = "";
        let __current_file = null;
        let blockid = 0;
        const BLOCK_CACHE = {};
        const INLINE_CACHE = {};
        function wrap(str) {
            if (config.message) {
                return `${config.message.split("\n").map(_ => "#" + _).join("\n")}\n${str}`
            }
            return `#file generated using Teak1MCBuilder\n${str}`;
        }
        process.stdout.write("\n");
        log("Starting build #" + buildid++);
        const start = new Date().getTime();
        global.mc = {
            registerMacro(name, func) {
                mc._macros[name] = {
                    exec(...args) {
                        if (this.config) this.config.apply();
                        return func.bind(this)(...args);
                    },
                    functions: {},
                    writeMacroCommandTo(func, command) {
                        this.functions[func] = this.functions[func] || [];
                        this.functions[func].push(command);
                    }
                };
            },
            registerFunction(name, commands) {
                functions[name] = commands;
            },
            _macros: {},
            MacroConfig: class MacroConfig {
                constructor(conf) {
                    this.conf = conf;
                    this.hasBeenWritten = false;
                }
                apply() {
                    if (!this.hasBeenWritten) {
                        if (this.conf.load) packFuncs.load.unshift(...this.conf.load);
                        if (this.conf.tick) packFuncs.tick.unshift(...this.conf.tick);
                        this.hasBeenWritten = true;
                    }
                }
            }
        }
        let config = {
            "generated": ["tick", "load"],
            "mode": "java"
        };
        if (fs.existsSync("./config.json")) {
            config = { ...config, ...JSON.parse(fs.readFileSync("./config.json", "utf8")) };
        } else if (fs.existsSync("./config.js")) {
            for (const id in require.cache) {
                if (id.endsWith("config.js")) {
                    delete require.cache[id];
                }
            }
            config = { ...config, ...require(path.resolve("./config.js")) }
        } else {
            fs.writeFileSync("./config.json", JSON.stringify(config, null, "\t"));
        }
        const BASEDIR = config.mode == "java" ? "/data" : "/functions";
        const loopValues = {
            env: config.env
        };
        for (let i = 0; i < files.length; i++) {
            name = files[i].substr(0, files[i].length - 3);
            buildFileFromPath(files[i]);
        }
        fs.mkdirSync(`.${BASEDIR}/computed/${config.mode === "java" ? "functions/" : ""}`, { recursive: true });
        for (let name in packFuncs) {
            THISWRITE.push(path.resolve(`.${BASEDIR}/computed/${config.mode === "java" ? "functions/" : ""}` + name + ".mcfunction"))
            fs.writeFileSync(`.${BASEDIR}/computed/${config.mode === "java" ? "functions/" : ""}` + name + ".mcfunction", wrap(packFuncs[name].join("\n")));
        }
        function buildFileFromPath(_path) {
            const start = new Date().getTime();
            __current_file = _path;
            mc.currentFile = __current_file;
            functions = {};
            // fs.mkdirSync("./data/" + _path.substr(0, _path.length - 3), { recursive: true });
            log("Building " + _path);
            const content = fs.readFileSync("./src/" + _path, "utf8").split("\n").map(_ => _.trim()).join("\n");
            const lines = content.split("\n");
            while (lines.length) {
                const line = lines.shift();
                parseLine(line, lines);
            }
            for (let name in functions) {
                if (config.generated.includes(name)) {
                    packFuncs[name] = packFuncs[name] || [];
                    packFuncs[name].push(...functions[name]);
                } else if (__current_file === config.bedrock_root_file) {
                    const fp = "./" + (BASEDIR) + "/" + (config.mode === "java" ? "/functions/" : "/") + name + ".mcfunction";
                    fs.mkdirSync(path.parse(fp).dir, { recursive: true })
                    THISWRITE.push(path.resolve(fp))
                    fs.writeFileSync(fp, wrap(functions[name].join("\n").replace(/\n\n+/g, "\n")));
                } else {
                    const fp = "./" + (BASEDIR) + "/" + _path.substr(0, _path.length - 3) + (config.mode === "java" ? "/functions/" : "/") + name + ".mcfunction";
                    fs.mkdirSync(path.parse(fp).dir, { recursive: true })
                    THISWRITE.push(path.resolve(fp))
                    fs.writeFileSync(fp, wrap(functions[name].join("\n").replace(/\n\n+/g, "\n")));
                }
            }
            const end = new Date().getTime();
            // log(`finished building ${__current_file} in ${end - start}ms`);
            process.stdout.write(` (${end - start}ms)`);
        }
        function parseLine(line, lines, noop) {
            if (line.startsWith("#")) return evaluate(line);
            if (line == "}") return "";
            if (/^function (.+)\s*{/.test(line)) {
                const _name = /^function (.+)\s*{/.exec(line)[1].trim();
                let content = getBlock(lines, noop);
                if (Array.isArray(content)) {
                    content = content.join("\n")
                }
                if (!noop) functions[_name] = content.replace(/\$block/g, name + ":" + _name).split("\n");
                return "#def function " + name + ":" + _name;
            } else if (/(execute .+?)\s*{$/.test(line)) {
                if (noop) {
                    getBlock(lines, noop);
                    return "#noop " + line;
                }
                let id = "g_" + (blockid++).toString(36);
                const commands = getBlock(lines, noop).map(evaluate).map(_ => _.replace(/function \$block/g, `function computed${config.mode == "java" ? ":" : "/"}${id}`));
                const cache_index = commands.join("");
                if (!BLOCK_CACHE[cache_index]) {
                    packFuncs[id] = commands;
                    BLOCK_CACHE[cache_index] = `$1 function computed${config.mode == "java" ? ":" : "/"}${id}\n`;
                }
                // console.log(functions[id]);
                return line.replace(/(execute .+?)\s*{$/, BLOCK_CACHE[cache_index]);
            } else if (/inline\s*{/.test(line)) {
                if (noop) {
                    getBlock(lines, noop);
                    return "#noop " + line;
                }
                let id = "g_" + (blockid++).toString(36);
                const commands = getBlock(lines, noop).map(evaluate).map(_ => _.replace(/function \$block/g, `function computed${config.mode == "java" ? ":" : "/"}${id}`));
                const cache_index = commands.join("");
                if (!INLINE_CACHE[cache_index]) {
                    packFuncs[id] = commands;
                    INLINE_CACHE[cache_index] = `function computed${config.mode == "java" ? ":" : "/"}${id}\n`;
                }
                return INLINE_CACHE[cache_index];
            } else if (/loop\s*\((.+),(.+)\)\s*{/.test(line)) {
                let [, count, variable] = line.match(/loop\s*\((.+),(.+)\)\s*{/);
                count = evaluate(count);
                let result = [];
                if (!noop) for (let i = 0; i < count; i++) {
                    loopValues[variable] = i;
                    const copy = [...lines];
                    const code = [];
                    getBlock(copy, noop).forEach(_ => Array.isArray(_) ? code.push(..._) : code.push(_));
                    for (let j = 0; j < code.length; j++) {
                        result.push(evaluate(code[j]));
                    }
                }
                delete loopValues[variable];
                getBlock(lines, true);
                // console.log(code, count, variable);
                return result.join("\n");
            } else if (/^@(.+)\((.*)\)/.test(line.trim())) {
                const [, name, args] = line.trim().match(/^@(.+)\((.*)\)/);
                const macro = global.mc._macros[name];
                if (macro) {
                    try {
                        const commands = macro.exec(...eval(`[${args}]`));
                        if (commands)
                            return Array.isArray(commands) ? commands.join("\n") : commands;
                        return "";
                    } catch (e) {
                        log("ERROR RUNNING MACRO");
                        log(e.message);
                        log(e.stack.split("\n")[1]);
                    }
                } else {
                    log("FATAL ERROR: MACRO NOT FOUND '" + name + "'");
                    process.exit(1);
                }
            } else if (/run @(.+)\((.*)\)$/.test(line.trim())) {
                const [, name, args] = line.trim().match(/run @(.+)\((.*)\)$/);
                const macro = global.mc._macros[name];
                if (macro) {
                    try {
                        const commands = macro.exec(...eval(`[${args}]`));
                        if (Array.isArray(commands)) {
                            log(`ERROR: MACRO INLINE FAILED, GOT ARRAY WHEN EXPECTING STRING FOR MACRO "${name}"`);
                        } else {
                            return line.replace(/run @(.+)\((.*)\)$/, "run " + commands);
                        }
                        return `#ERROR: MACRO INLINE FAILED, GOT ARRAY WHEN EXPECTING STRING FOR MACRO "${name}"`;
                    } catch (e) {
                        log("ERROR RUNNING MACRO");
                        log(e.message);
                        log(e.stack.split("\n")[1]);
                    }
                } else {
                    log("FATAL ERROR: MACRO NOT FOUND '" + name + "'");
                    process.exit(1);
                }
            }
            return evaluate(line);
        }
        function evaluate(line) {
            try {
                return (new Function('return `' + line.replace(/\\/g, `\\\\`).replace(/<%/g, "${").replace(/%>/g, "}") + '`')).bind(loopValues)();
            } catch (e) {
                log("ERROR:" + __current_file + "@" + line);
                log(e.message);
                return "#ERROR:" + __current_file + "@" + line + "\n#e.message";
            }
        }
        function getBlock(lines, noop) {
            if (!lines) {
                log("here!");
            }
            const res = [];
            let level = 1;
            while (lines.length && level > 0) {
                if (lines[0] == "}") level--;
                if (lines[0].match(/{$/)) level++;
                if (level != 0) res.push(parseLine(lines.shift(), lines, noop));
            }
            return res;
        }
        if (config.mode === "java") {
            fs.mkdirSync("./data/minecraft/tags/functions", { recursive: true });
            THISWRITE.push(path.resolve("./data/minecraft/tags/functions/tick.json"))
            fs.writeFileSync("./data/minecraft/tags/functions/tick.json", JSON.stringify({
                values: ["computed:tick"],
                replace: false
            }));
            THISWRITE.push(path.resolve("./data/minecraft/tags/functions/load.json"))
            fs.writeFileSync("./data/minecraft/tags/functions/load.json", JSON.stringify({
                values: ["computed:load"],
                replace: false
            }));
        } else {
            fs.mkdirSync("./functions", { recursive: true });
            THISWRITE.push(path.resolve("./functions/tick.mcfunction"))
            fs.writeFileSync("./functions/tick.mcfunction", "function computed/tick")
        }
        log("Cleaning up last build");
        const clean_start = new Date().getTime();
        const LASTWRITE = [];
        const lws = fs.existsSync("./.mcproject") ? JSON.parse(fs.readFileSync(".mcproject", "utf8")) : [];
        lws.forEach((item) => {
            if (THISWRITE.indexOf(item) === -1) {
                LASTWRITE.push(item);
            }
        })
        for (let i = 0; i < LASTWRITE.length; i++) {
            const file = LASTWRITE[i];
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
            }
            const parts = path.parse(file).dir.split("\\");
            let _path = parts.join("\\");
            let done = true;
            while (fs.existsSync(_path) && done) {
                if (parts.pop() === "data") {
                    done = false;
                }
                try {
                    if (fs.readdirSync(_path).length > 0) {
                        done = false;
                    } else {
                        fs.rmdirSync(_path);
                    }
                } catch (e) {
                    done = false;
                }
                _path = parts.join("\\");
            }
        }
        const clean_end = new Date().getTime();
        fs.writeFileSync("./.mcproject", JSON.stringify(THISWRITE));
        process.stdout.write(` (${clean_end - clean_start}ms)`);
        const end = new Date().getTime();
        log(`Build took ${end - start}ms`);
    }
    watch.watchTree("./src", run);
}